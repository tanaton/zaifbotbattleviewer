package main

import (
	"bufio"
	"compress/gzip"
	"context"
	"encoding/gob"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/ioutil"
	"math/rand"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"sync"
	"syscall"
	"time"

	"github.com/NYTimes/gziphandler"
	"github.com/gorilla/websocket"
	"github.com/tanaton/dtoa"
	"go.uber.org/zap"
	"golang.org/x/crypto/acme/autocert"
)

const (
	StoreDataMax = 1 << 14 // 16384
)

type PriceAmount [2]float64
type LastPrice struct {
	Action string  `json:"action"`
	Price  float64 `json:"price"`
}
type Trade struct {
	CurrentyPair string  `json:"currenty_pair"`
	TradeType    string  `json:"trade_type"`
	Price        float64 `json:"price"`
	Tid          uint64  `json:"tid"`
	Amount       float64 `json:"amount"`
	Date         uint64  `json:"date"`
}
type Timestamp time.Time

func (ts *Timestamp) UnmarshalJSON(data []byte) error {
	// 2019-07-08 18:59:36.105162
	loc, _ := time.LoadLocation("Asia/Tokyo")
	t, err := time.ParseInLocation(`"2006-01-02 15:04:05.000000"`, string(data), loc)
	*ts = Timestamp(t)
	return err
}

type Unixtime time.Time

func (ts *Unixtime) UnmarshalJSON(data []byte) error {
	i, err := strconv.ParseInt(string(data), 10, 64)
	t := time.Unix(i, 0)
	*ts = Unixtime(t)
	return err
}
func (ts Unixtime) MarshalJSON() ([]byte, error) {
	buf := make([]byte, 0, 10)
	return strconv.AppendInt(buf, time.Time(ts).Unix(), 10), nil
}
func (ts *Unixtime) UnmarshalBinary(data []byte) error {
	t := time.Time(*ts)
	err := t.UnmarshalBinary(data)
	*ts = Unixtime(t)
	return err
}
func (ts Unixtime) MarshalBinary() ([]byte, error) {
	return time.Time(ts).MarshalBinary()
}

type Stream struct {
	Asks         []PriceAmount `json:"asks"`
	Bids         []PriceAmount `json:"bids"`
	Trades       []Trade       `json:"trades"`
	Timestamp    Timestamp     `json:"timestamp"`
	LastPrice    LastPrice     `json:"last_price"`
	CurrentyPair string        `json:"currency_pair"`
}
type StoreData struct {
	Ask       *PriceAmount `json:"ask,omitempty"`
	Bid       *PriceAmount `json:"bid,omitempty"`
	Trade     *Trade       `json:"trade,omitempty"`
	Timestamp Unixtime     `json:"ts"`
}
type StoreItem struct {
	date     time.Time
	name     string
	nonempty bool
	w        *bufio.Writer
	fp       *os.File
	buf      []byte
}
type Output struct {
	Code   int
	Header http.Header
	Reader io.Reader
	ZFlag  bool
}
type Srv struct {
	s *http.Server
	f func(s *http.Server) error
}
type ResultMonitor struct {
	err                 error
	ResponseTimeSum     time.Duration
	ResponseCount       uint
	ResponseCodeOkCount uint
	ResponseCodeNgCount uint
}
type StoreDataArray []StoreData
type OldStreamHandler struct {
	cp string
	ch <-chan StoreDataArray
}
type LastPriceHandler struct {
	ch <-chan LastPrice
}
type GetMonitoringHandler struct {
	ch <-chan ResultMonitor
}

var gzipContentTypeList = []string{
	"text/html",
	"text/css",
	"text/javascript",
	"text/plain",
	"application/json",
}
var zaifStremUrlList = map[string]string{
	"btc_jpy":  "wss://ws.zaif.jp/stream?currency_pair=btc_jpy",
	"xem_jpy":  "wss://ws.zaif.jp/stream?currency_pair=xem_jpy",
	"mona_jpy": "wss://ws.zaif.jp/stream?currency_pair=mona_jpy",
	"bch_jpy":  "wss://ws.zaif.jp/stream?currency_pair=bch_jpy",
	"eth_jpy":  "wss://ws.zaif.jp/stream?currency_pair=eth_jpy",
}
var log *zap.SugaredLogger

func init() {
	logger, err := zap.NewProduction()
	if err != nil {
		panic(err)
	}
	log = logger.Sugar()
	rand.Seed(time.Now().UnixNano())
}

func main() {
	var wg sync.WaitGroup
	ctx, exitch := startExitManageProc(context.Background(), &wg)

	for key, u := range zaifStremUrlList {
		sdch := make(chan StoreDataArray)
		sch := make(chan Stream, 8)
		storesch := make(chan StoreData, 32)
		lpch := make(chan LastPrice)
		wg.Add(1)
		go streamReaderProc(ctx, &wg, u, sch)
		wg.Add(1)
		go streamStoreProc(ctx, &wg, key, sch, storesch, sdch, lpch)
		wg.Add(1)
		go storeWriterProc(ctx, &wg, key, storesch)
		// URL設定
		http.Handle("/api/zaif/1/oldstream/"+key, &OldStreamHandler{cp: key, ch: sdch})
		http.Handle("/api/zaif/1/lastprice/"+key, &LastPriceHandler{ch: lpch})
	}

	monich := make(chan ResultMonitor)
	rich := make(chan ResponseInfo, 32)

	wg.Add(1)
	go serverMonitoringProc(ctx, &wg, rich, monich)

	// URL設定
	http.Handle("/api/unko.in/1/monitor", &GetMonitoringHandler{ch: monich})
	http.Handle("/", http.FileServer(http.Dir("./public_html")))

	ghfunc, err := gziphandler.GzipHandlerWithOpts(gziphandler.CompressionLevel(gzip.BestSpeed), gziphandler.ContentTypes(gzipContentTypeList))
	if err != nil {
		exitch <- struct{}{}
		log.Infow("サーバーハンドラの作成に失敗しました。", "error", err)
		shutdown(ctx, &wg)
	}
	h := MonitoringHandler(ghfunc(http.DefaultServeMux), rich)

	// サーバ情報
	sl := []Srv{
		Srv{
			s: &http.Server{Addr: ":8080", Handler: h},
			f: func(s *http.Server) error { return s.ListenAndServe() },
		},
		Srv{
			s: &http.Server{Handler: h},
			f: func(s *http.Server) error { return s.Serve(autocert.NewListener("crypto.unko.in")) },
		},
	}
	for _, s := range sl {
		s := s // ローカル化
		wg.Add(1)
		go s.startServer(&wg)
	}
	// シャットダウン管理
	shutdown(ctx, &wg, sl...)
}

// MonitoringHandler モニタリング用ハンドラ生成
func MonitoringHandler(h http.Handler, rich chan<- ResponseInfo) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		bbrw := NewMonitoringResponseWriter(w, r, rich)
		h.ServeHTTP(bbrw, r)
		bbrw.Finish()
	})
}

func (srv *Srv) startServer(wg *sync.WaitGroup) {
	defer wg.Done()
	log.Infow("Srv.startServer", "Addr", srv.s.Addr)
	// サーバ起動
	err := srv.f(srv.s)
	// サーバが終了した場合
	if err != nil {
		if err == http.ErrServerClosed {
			log.Infow("サーバーがシャットダウンしました。", "error", err, "Addr", srv.s.Addr)
		} else {
			log.Warnw("サーバーが落ちました。", "error", err)
		}
	}
}

func shutdown(ctx context.Context, wg *sync.WaitGroup, sl ...Srv) {
	// シグナル等でサーバを中断する
	<-ctx.Done()
	// シャットダウン処理用コンテキストの用意
	sctx, scancel := context.WithCancel(context.Background())
	defer scancel()
	for _, srv := range sl {
		wg.Add(1)
		go func(srv *http.Server) {
			ssctx, sscancel := context.WithTimeout(sctx, time.Second*10)
			defer func() {
				sscancel()
				wg.Done()
			}()
			err := srv.Shutdown(ssctx)
			if err != nil {
				log.Warnw("サーバーの終了に失敗しました。", "error", err)
			} else {
				log.Infow("サーバーの終了に成功しました。", "Addr", srv.Addr)
			}
		}(srv.s)
	}
	// サーバーの終了待機
	wg.Wait()
	log.Sync()
	os.Exit(0)
}

func startExitManageProc(ctx context.Context, wg *sync.WaitGroup) (context.Context, chan<- struct{}) {
	exitch := make(chan struct{}, 1)
	ectx, cancel := context.WithCancel(ctx)
	wg.Add(1)
	go func(ch <-chan struct{}) {
		sig := make(chan os.Signal, 1)
		signal.Notify(sig,
			syscall.SIGHUP,
			syscall.SIGINT,
			syscall.SIGTERM,
			syscall.SIGQUIT,
			os.Interrupt,
			os.Kill,
		)
		defer func() {
			signal.Stop(sig)
			cancel()
			wg.Done()
		}()

		select {
		case <-ectx.Done():
			log.Infow("Cancel from parent")
		case s := <-sig:
			log.Infow("Signal!!", "signal", s)
		case <-ch:
			log.Infow("Exit command!!")
		}
	}(exitch)
	return ectx, exitch
}

func streamReaderProc(ctx context.Context, wg *sync.WaitGroup, wss string, wsch chan<- Stream) {
	defer wg.Done()
	defer close(wsch)
	wait := time.Duration(rand.Uint64()%5000) * time.Millisecond
	for {
		time.Sleep(wait)
		log.Infow("Websoket接続", "path", wss)
		exit := func() (exit bool) {
			ch := make(chan error, 1)
			dialctx, dialcancel := context.WithTimeout(ctx, time.Second*7)
			defer func() {
				dialcancel()
				close(ch)
			}()
			con, _, dialerr := websocket.DefaultDialer.DialContext(dialctx, wss, nil)
			if dialerr != nil {
				// Dialが失敗した理由がよくわからない
				// contextを伝搬してきた通知で失敗した？普通にタイムアウトした？
				// 先の処理に丸投げ
				ch <- dialerr
			} else {
				defer con.Close()
				wg.Add(1)
				go func() {
					defer wg.Done()
					for {
						s := Stream{}
						err := con.ReadJSON(&s)
						if err != nil {
							ch <- err
							return
						}
						wsch <- s
					}
				}()
			}
			select {
			case <-ctx.Done():
				// シャットダウンする場合
				if con != nil {
					con.Close()
				}
				<-ch
				exit = true
			case err := <-ch:
				// 普通の通信異常（リトライするやつ）
				log.Warnw("websocket通信に失敗しました。", "error", err, "url", wss)
				exit = false
			}
			return exit
		}()
		if exit {
			log.Infow("streamReaderProc終了", "url", wss)
			return
		}
		if wait < 180*time.Second {
			wait *= 2
			wait += time.Duration(rand.Uint64() % 5000)
		}
	}
}

func streamStoreProc(ctx context.Context, wg *sync.WaitGroup, key string, rsch <-chan Stream, wsch chan<- StoreData, sdch chan<- StoreDataArray, lpch chan<- LastPrice) {
	defer wg.Done()
	defer close(wsch)
	oldstream := Stream{}
	sda, err := streamBufferReadProc(key)
	if err != nil {
		log.Warnw("バッファの読み込みに失敗しました。", "error", err, "key", key)
	}
	sdatmp := sda.Duplicate()
	defer func() {
		if sda != nil {
			err := streamBufferWriteProc(key, sda)
			if err != nil {
				log.Warnw("バッファの保存に失敗しました。", "error", err, "key", key)
			}
			sda.Close()
		}
		if sdatmp != nil {
			sdatmp.Close()
		}
	}()
	for {
		select {
		case <-ctx.Done():
			log.Infow("streamStoreProc終了", "key", key)
			return
		case s := <-rsch:
			sd, ok := StreamToStoreData(s, oldstream)
			oldstream = s
			if ok {
				sda.Push(sd)
				sdatmp.Push(sd)
				select {
				case wsch <- sd:
				default:
					// 送信できなかったらすぐに諦める
				}
			}
		case sdch <- sdatmp:
			sdatmp = sda.Duplicate()
		case lpch <- oldstream.LastPrice:
		}
	}
}

func streamBufferReadProc(key string) (StoreDataArray, error) {
	p := createBufferFilePath(key)
	rfp, err := os.Open(p)
	if err != nil {
		return nil, err
	}
	defer rfp.Close()
	sda := NewStoreDataArray()
	err = gob.NewDecoder(rfp).Decode(&sda)
	return sda, err
}

func streamBufferWriteProc(key string, sda StoreDataArray) error {
	p := createBufferFilePath(key)
	direrr := createDir(p)
	if direrr != nil {
		return direrr
	}
	wfp, err := os.Create(p)
	if err != nil {
		return err
	}
	defer wfp.Close()
	return gob.NewEncoder(wfp).Encode(sda)
}

func storeWriterProc(ctx context.Context, wg *sync.WaitGroup, key string, rsch <-chan StoreData) {
	defer wg.Done()
	var old time.Time
	var si *StoreItem
	for {
		select {
		case <-ctx.Done():
			if si != nil {
				si.Close()
			}
			log.Infow("storeWriterProc終了", "key", key)
			return
		case sd := <-rsch:
			date := time.Time(sd.Timestamp)
			if si == nil {
				var err error
				si, err = NewStoreItem(date, key)
				if err != nil {
					log.Warnw("JSONファイル生成に失敗しました。", "error", err, "name", key)
					break
				}
			} else if date.Day() != old.Day() {
				err := si.nextFile(date)
				if err != nil {
					log.Warnw("JSONファイル生成に失敗しました。", "error", err, "name", key)
					break
				}
			}
			old = date
			err := si.WriteJsonLine(sd)
			if err != nil {
				log.Warnw("JSONファイル出力に失敗しました。", "error", err)
			}
		}
	}
}

// サーバお手軽監視用
func serverMonitoringProc(ctx context.Context, wg *sync.WaitGroup, rich <-chan ResponseInfo, monich chan<- ResultMonitor) {
	defer wg.Done()
	res := ResultMonitor{}
	resmin := ResultMonitor{}
	tc := time.NewTicker(time.Minute)
	for {
		select {
		case <-ctx.Done():
			log.Infow("serverMonitoringProc終了")
			tc.Stop()
			return
		case ri := <-rich:
			res.ResponseCount++
			res.ResponseTimeSum += ri.end.Sub(ri.start)
			if ri.code < 400 {
				res.ResponseCodeOkCount++
			} else {
				res.ResponseCodeNgCount++
			}
		case monich <- resmin:
		case <-tc.C:
			if res.ResponseCount > 0 {
				resmin = res
			} else {
				resmin = ResultMonitor{}
			}
			res = ResultMonitor{}
		}
	}
}

func NewStoreItem(date time.Time, name string) (*StoreItem, error) {
	si := &StoreItem{}
	si.buf = make([]byte, 0, 16*1024)
	si.date = date
	si.name = name
	si.nonempty = false
	si.w = bufio.NewWriterSize(ioutil.Discard, 16*1024)
	p := si.createPathTmp()
	if err := createDir(p); err != nil {
		return nil, err
	}
	err := si.fileopen(p)
	return si, err
}

func (si *StoreItem) WriteJsonLine(sd StoreData) error {
	if si.nonempty {
		si.w.Write([]byte{',', '\n'})
	}
	si.buf = si.buf[:0]
	si.buf = StoreDataToJSON(si.buf, sd)
	_, err := si.w.Write(si.buf)
	si.nonempty = true
	return err
}

func (si *StoreItem) Close() error {
	si.w.Flush()
	si.fp.Close()
	si.fp = nil
	return si.store()
}

func (si *StoreItem) fileopen(p string) error {
	st, err := os.Stat(p)
	if err != nil {
		fp, err := os.Create(p)
		if err != nil {
			return err
		}
		si.fp = fp
		si.w.Reset(si.fp)
		si.w.WriteByte('[')
		si.w.Flush() // JSONの正しさを保つために書き込みしておく
		si.nonempty = false
	} else {
		fp, err := os.OpenFile(p, os.O_CREATE|os.O_APPEND|os.O_RDWR, 0666)
		if err != nil {
			return err
		}
		si.fp = fp
		si.w.Reset(si.fp)
		si.nonempty = st.Size() > 2
	}
	return nil
}

func (si *StoreItem) nextFile(date time.Time) error {
	si.w.WriteByte(']')
	si.Close()
	si.date = date
	p := si.createPathTmp()
	return si.fileopen(p)
}

func (si *StoreItem) store() error {
	n := createStoreFilePath(si.date, si.name) + ".gz"
	o := si.createPathTmp()
	rfp, err := os.Open(o)
	if err != nil {
		return err
	}
	defer rfp.Close()
	wfp, err := os.Create(n)
	if err != nil {
		return err
	}
	defer wfp.Close()
	gz, _ := gzip.NewWriterLevel(wfp, gzip.BestSpeed)
	defer gz.Close()
	r := bufio.NewReaderSize(rfp, 128*1024)
	_, err = io.Copy(gz, r)
	return err
}

func (si *StoreItem) createPathTmp() string {
	return createStoreFilePath(si.date, si.name) + ".tmp"
}

func createDir(p string) error {
	dir := filepath.Dir(p)
	if dir == "." {
		return nil
	}
	st, err := os.Stat(dir)
	if err != nil {
		err = os.MkdirAll(dir, 0666)
	} else {
		if st.IsDir() == false {
			err = errors.New("フォルダ以外の何かがあるよ")
		}
	}
	return err
}

func createStoreFilePath(date time.Time, name string) string {
	return filepath.Join("data", fmt.Sprintf("%s_%s.json", date.Format("20060102"), name))
}

func createBufferFilePath(name string) string {
	return filepath.Join("data", fmt.Sprintf("%s_buffer.gob", name))
}

type ResponseInfo struct {
	path      string
	userAgent string
	code      int
	size      int
	start     time.Time
	end       time.Time
}
type MonitoringResponseWriter struct {
	w    http.ResponseWriter
	ri   ResponseInfo
	rich chan<- ResponseInfo
}

func NewMonitoringResponseWriter(w http.ResponseWriter, r *http.Request, rich chan<- ResponseInfo) *MonitoringResponseWriter {
	return &MonitoringResponseWriter{
		w: w,
		ri: ResponseInfo{
			path:      r.URL.Path,
			userAgent: r.UserAgent(),
			start:     time.Now(),
		},
		rich: rich,
	}
}
func (bbrw *MonitoringResponseWriter) Header() http.Header {
	return bbrw.w.Header()
}
func (bbrw *MonitoringResponseWriter) Write(buf []byte) (int, error) {
	s, err := bbrw.w.Write(buf)
	bbrw.ri.size += s
	return s, err
}
func (bbrw *MonitoringResponseWriter) WriteHeader(statusCode int) {
	bbrw.ri.code = statusCode
	bbrw.w.WriteHeader(statusCode)
}
func (bbrw *MonitoringResponseWriter) Finish() {
	bbrw.ri.end = time.Now()
	bbrw.rich <- bbrw.ri
}

var storeDataArrayPool = sync.Pool{
	New: func() interface{} {
		return StoreDataArray(make([]StoreData, 0, StoreDataMax))
	},
}

func NewStoreDataArray() StoreDataArray {
	return storeDataArrayPool.Get().(StoreDataArray)
}
func (sda *StoreDataArray) Duplicate() StoreDataArray {
	sda2 := NewStoreDataArray()
	sda2 = append(sda2, (*sda)...)
	return sda2
}
func (sda *StoreDataArray) Push(sd StoreData) {
	*sda = append(*sda, sd)
	if len(*sda) > StoreDataMax {
		(*sda)[0] = StoreData{}
		*sda = (*sda)[1:]
	}
}
func (sda StoreDataArray) Len() int {
	return len(sda)
}
func (sda *StoreDataArray) Close() error {
	*sda = (*sda)[:0]
	storeDataArrayPool.Put(*sda)
	return nil
}

func StreamToStoreData(s, olds Stream) (StoreData, bool) {
	valid := false
	sd := StoreData{}
	sd.Timestamp = Unixtime(s.Timestamp)
	if len(olds.Asks) == 0 {
		sd.Ask = &s.Asks[0]
		sd.Bid = &s.Bids[0]
		sd.Trade = &s.Trades[0]
		valid = true
	} else {
		switch {
		case s.Asks[0][0] != olds.Asks[0][0],
			s.Asks[0][1] != olds.Asks[0][1]:
			sd.Ask = &s.Asks[0]
			valid = true
		}
		switch {
		case s.Bids[0][0] != olds.Bids[0][0],
			s.Bids[0][1] != olds.Bids[0][1]:
			sd.Bid = &s.Bids[0]
			valid = true
		}
		switch {
		case s.Trades[0].TradeType != olds.Trades[0].TradeType,
			s.Trades[0].Price != olds.Trades[0].Price,
			s.Trades[0].Tid != olds.Trades[0].Tid,
			s.Trades[0].Amount != olds.Trades[0].Amount:
			sd.Trade = &s.Trades[0]
			valid = true
		}
	}
	return sd, valid
}

func (h *OldStreamHandler) getStoreData(ctx context.Context) (sda StoreDataArray, err error) {
	lctx, lcancel := context.WithTimeout(ctx, time.Second*3)
	defer lcancel()
	select {
	case <-lctx.Done():
		err = errors.New("timeout")
	case sda = <-h.ch:
	}
	return
}

func StoreDataToJSON(buf []byte, sd StoreData) []byte {
	buf = append(buf, '{')
	if sd.Ask != nil {
		buf = append(buf, `"ask":[`...)
		buf = dtoa.DtoaSimple(buf, sd.Ask[0], -1)
		buf = append(buf, ',')
		buf = dtoa.DtoaSimple(buf, sd.Ask[1], -1)
		buf = append(buf, `],`...)
	}
	if sd.Bid != nil {
		buf = append(buf, `"bid":[`...)
		buf = dtoa.DtoaSimple(buf, sd.Bid[0], -1)
		buf = append(buf, ',')
		buf = dtoa.DtoaSimple(buf, sd.Bid[1], -1)
		buf = append(buf, `],`...)
	}
	if sd.Trade != nil {
		buf = append(buf, `"trade":{"currenty_pair":"`...)
		buf = append(buf, sd.Trade.CurrentyPair...)
		buf = append(buf, `","trade_type":"`...)
		buf = append(buf, sd.Trade.TradeType...)
		buf = append(buf, `","price":`...)
		buf = dtoa.DtoaSimple(buf, sd.Trade.Price, -1)
		buf = append(buf, `,"tid":`...)
		buf = strconv.AppendUint(buf, sd.Trade.Tid, 10)
		buf = append(buf, `,"amount":`...)
		buf = dtoa.DtoaSimple(buf, sd.Trade.Amount, -1)
		buf = append(buf, `,"date":`...)
		buf = strconv.AppendUint(buf, sd.Trade.Date, 10)
		buf = append(buf, `},`...)
	}
	buf = append(buf, `"ts":`...)
	buf = strconv.AppendInt(buf, time.Time(sd.Timestamp).Unix(), 10)
	buf = append(buf, '}')
	return buf
}

func StoreDataArrayToJSON(w io.Writer, sda StoreDataArray) {
	buf := make([]byte, 0, 32*1024)
	buf = append(buf, '[')
	for i, sd := range sda {
		if i > 0 {
			buf = append(buf, ',')
		}
		buf = StoreDataToJSON(buf, sd)
		if len(buf) > 16*1024 {
			w.Write(buf)
			buf = buf[:0]
		}
	}
	buf = append(buf, ']')
	w.Write(buf)
}

func (h *OldStreamHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	sda, err := h.getStoreData(r.Context())
	if err == nil {
		defer sda.Close()
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		StoreDataArrayToJSON(w, sda)
	} else {
		http.NotFound(w, r)
	}
}

func (h *LastPriceHandler) getLastPrice(ctx context.Context) (LastPrice, error) {
	var res LastPrice
	lctx, lcancel := context.WithTimeout(ctx, time.Second*3)
	defer lcancel()
	select {
	case <-lctx.Done():
		return res, errors.New("timeout")
	case res = <-h.ch:
	}
	return res, nil
}

func (h *LastPriceHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	res, err := h.getLastPrice(r.Context())
	if err == nil {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		err := json.NewEncoder(w).Encode(res)
		if err != nil {
			log.Warnw("JSON出力に失敗しました。", "error", err, "path", r.URL.Path)
		}
	} else {
		http.Error(w, "データ取得に失敗しました。", http.StatusInternalServerError)
	}
}

func (h *GetMonitoringHandler) getResultMonitor(ctx context.Context) (ResultMonitor, error) {
	var res ResultMonitor
	lctx, lcancel := context.WithTimeout(ctx, time.Second*3)
	defer lcancel()
	select {
	case <-lctx.Done():
		return res, errors.New("timeout")
	case res = <-h.ch:
	}
	return res, nil
}

func (h *GetMonitoringHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	res, err := h.getResultMonitor(r.Context())
	if err == nil {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		err := json.NewEncoder(w).Encode(res)
		if err != nil {
			log.Warnw("JSON出力に失敗しました。", "error", err, "path", r.URL.Path)
		}
	} else {
		http.Error(w, "データ取得に失敗しました。", http.StatusInternalServerError)
	}
}
