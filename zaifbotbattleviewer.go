package main

import (
	"bufio"
	"compress/gzip"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/rand"
	"net/http"
	"os"
	"os/signal"
	"path"
	"path/filepath"
	"strconv"
	"sync"
	"syscall"
	"time"

	"github.com/NYTimes/gziphandler"
	"github.com/gorilla/websocket"
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
type StreamPacket struct {
	name string
	s    Stream
}
type StoreDataPacket struct {
	name string
	sd   StoreData
}
type StoreItem struct {
	date time.Time
	name string
	gw   *gzip.Writer
	w    *bufio.Writer
	fp   *os.File
}
type Result struct {
	err error
	sl  []StoreData
}
type Request struct {
	name   string
	filter func([]StoreData) []StoreData
	wch    chan<- Result
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
type RequestMonitor struct {
	wch chan<- ResultMonitor
}
type OldStreamHandler struct {
	reqch chan<- Request
}
type GetMonitoringHandler struct {
	monich chan<- RequestMonitor
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
	reqch := make(chan Request, 8)
	monich := make(chan RequestMonitor, 8)
	rich := make(chan ResponseInfo, 32)
	sch := make(chan StreamPacket, 32)
	storesch := make(chan StoreDataPacket, 32)

	ctx, exitch := startExitManageProc(context.Background(), &wg)
	for key, u := range zaifStremUrlList {
		// ローカル化
		key := key
		u := u
		wg.Add(1)
		go streamReaderProc(ctx, &wg, u, key, sch)
	}
	wg.Add(1)
	go streamStoreProc(ctx, &wg, sch, storesch, reqch)
	wg.Add(1)
	go storeWriterProc(ctx, &wg, storesch)
	wg.Add(1)
	go serverMonitoringProc(ctx, &wg, rich, monich)

	// URL設定
	http.Handle("/api/zaif/1/oldstream/", &OldStreamHandler{reqch: reqch})
	http.Handle("/api/unko.in/1/monitor", &GetMonitoringHandler{monich: monich})
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

func streamReaderProc(ctx context.Context, wg *sync.WaitGroup, wss, key string, wsch chan<- StreamPacket) {
	defer wg.Done()
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
				defer con.Close() // 2回呼ばれるかも
				go func() {
					for {
						s := Stream{}
						err := con.ReadJSON(&s)
						if err != nil {
							ch <- err
							return
						}
						wsch <- StreamPacket{
							name: key,
							s:    s,
						}
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
				log.Warnw("websocket通信に失敗しました。", "error", err, "url", wss, "key", key)
				exit = false
			}
			return exit
		}()
		if exit {
			log.Infow("streamReaderProc終了", "url", wss, "key", key)
			return
		}
		if wait < 180*time.Second {
			wait *= 2
			wait += time.Duration(rand.Uint64() % 5000)
		}
	}
}

func streamStoreProc(ctx context.Context, wg *sync.WaitGroup, rsch <-chan StreamPacket, wsch chan<- StoreDataPacket, reqch <-chan Request) {
	defer wg.Done()
	slm := make(map[string][]StoreData, 8)
	oldstream := make(map[string]Stream, 8)
	now := time.Now()
	for key := range zaifStremUrlList {
		sl, err := storeReaderProc(now, key)
		if err != nil {
			log.Warnw("ファイル読み込み失敗", "error", err)
		}
		slm[key] = sl
	}
	for {
		select {
		case <-ctx.Done():
			log.Infow("streamStoreProc終了")
			return
		case it := <-rsch:
			sl, ok := appendStore(slm[it.name], it.s, oldstream[it.name])
			slm[it.name] = sl
			oldstream[it.name] = it.s
			if ok {
				wsch <- StoreDataPacket{
					name: it.name,
					sd:   slm[it.name][len(slm[it.name])-1],
				}
			}
		case it := <-reqch:
			if sl, ok := slm[it.name]; ok {
				if it.filter != nil {
					sl = it.filter(sl)
				}
				it.wch <- Result{
					err: nil,
					sl:  sl,
				}
			} else {
				it.wch <- Result{
					err: errors.New("存在しないキーです。"),
				}
			}
		}
	}
}

func storeReaderProc(now time.Time, key string) ([]StoreData, error) {
	sir, err := NewStoreItemReader(now, key)
	if err != nil {
		return nil, err
	}
	defer sir.Close()
	sl := make([]StoreData, 0, StoreDataMax+1)
	scanner := bufio.NewScanner(sir)
	for scanner.Scan() {
		sd := StoreData{}
		err := json.Unmarshal(scanner.Bytes(), &sd)
		if err != nil {
			log.Warnw("JSON解析失敗", "error", err, "json", scanner.Text())
			break
		}
		sl = append(sl, sd)
		for len(sl) > StoreDataMax {
			sl[0] = StoreData{}
			sl = sl[1:]
		}
	}
	return sl, nil
}

func storeWriterProc(ctx context.Context, wg *sync.WaitGroup, rsch <-chan StoreDataPacket) {
	defer wg.Done()
	old := time.Now()
	tc := time.NewTicker(time.Second)
	m := make(map[string]*StoreItem, 8)
	for {
		select {
		case <-ctx.Done():
			for _, it := range m {
				it.Close()
			}
			tc.Stop()
			log.Infow("storeWriterProc終了")
			return
		case it := <-rsch:
			si, ok := m[it.name]
			if !ok {
				var err error
				si, err = NewStoreItem(old, it.name)
				if err != nil {
					log.Warnw("JSONファイル生成に失敗しました。", "error", err, "name", it.name)
					break
				}
				err = si.readData()
				if err != nil {
					log.Infow("JSONバックアップファイルの読み込みができませんでした。", "error", err, "name", it.name)
				}
				m[it.name] = si
			}
			err := json.NewEncoder(si.w).Encode(it.sd)
			if err != nil {
				log.Warnw("JSONファイル出力に失敗しました。", "error", err)
			}
		case now := <-tc.C:
			if now.Day() != old.Day() {
				for key, it := range m {
					it.Close()
					err := it.reset(now, key)
					if err != nil {
						log.Warnw("JSONファイル生成に失敗しました。", "error", err, "name", key)
						break
					}
				}
				old = now
			}
		}
	}
}

// サーバお手軽監視用
func serverMonitoringProc(ctx context.Context, wg *sync.WaitGroup, rich <-chan ResponseInfo, monich <-chan RequestMonitor) {
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
		case m := <-monich:
			m.wch <- resmin
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
	si.date = date
	si.name = name
	p := si.createPathTmp()
	if err := createDir(p); err != nil {
		return nil, err
	}
	fp, err := os.Create(p)
	if err != nil {
		return nil, err
	}
	si.gw, _ = gzip.NewWriterLevel(fp, gzip.BestSpeed)
	si.w = bufio.NewWriterSize(si.gw, 16*1024)
	si.fp = fp
	return si, nil
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

func (si *StoreItem) reset(date time.Time, name string) error {
	si.date = date
	p := si.createPathTmp()
	fp, err := os.Create(p)
	if err != nil {
		return err
	}
	si.fp = fp
	si.gw.Reset(si.fp)
	si.w.Reset(si.gw)
	return nil
}

func (si *StoreItem) readData() error {
	sir, err := NewStoreItemReader(si.date, si.name)
	if err != nil {
		return err
	}
	defer sir.Close()
	_, err = io.Copy(si.w, sir)
	return err
}

func (si *StoreItem) Flush() error {
	return si.w.Flush()
}

func (si *StoreItem) Close() error {
	si.Flush()
	si.gw.Close()
	si.fp.Close()
	n := createStoreFilePath(si.date, si.name)
	o := si.createPathTmp()
	return os.Rename(o, n)
}

func (si *StoreItem) createPathTmp() string {
	return createStoreFilePath(si.date, si.name) + ".tmp"
}

func createStoreFilePath(date time.Time, name string) string {
	return filepath.Join("data", fmt.Sprintf("%s_%s.json.gz", date.Format("20060102"), name))
}

type StoreItemReader struct {
	fp *os.File
	gr *gzip.Reader
}

func NewStoreItemReader(date time.Time, name string) (*StoreItemReader, error) {
	sir := &StoreItemReader{}
	p := createStoreFilePath(date, name)
	var err error
	sir.fp, err = os.Open(p)
	if err != nil {
		return nil, err
	}
	sir.gr, err = gzip.NewReader(sir.fp)
	if err != nil {
		sir.fp.Close()
		return nil, err
	}
	return sir, nil
}
func (sir *StoreItemReader) Read(p []byte) (n int, err error) {
	return sir.gr.Read(p)
}
func (sir *StoreItemReader) Close() error {
	sir.gr.Close()
	return sir.fp.Close()
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

func appendStore(sl []StoreData, s, olds Stream) ([]StoreData, bool) {
	write := false
	sd := StoreData{}
	sd.Timestamp = Unixtime(s.Timestamp)
	if len(olds.Asks) == 0 {
		sd.Ask = &s.Asks[0]
		sd.Bid = &s.Bids[0]
		sd.Trade = &s.Trades[0]
		write = true
	} else {
		switch {
		case s.Asks[0][0] != olds.Asks[0][0],
			s.Asks[0][1] != olds.Asks[0][1]:
			sd.Ask = &s.Asks[0]
			write = true
		}
		switch {
		case s.Bids[0][0] != olds.Bids[0][0],
			s.Bids[0][1] != olds.Bids[0][1]:
			sd.Bid = &s.Bids[0]
			write = true
		}
		switch {
		case s.Trades[0].TradeType != olds.Trades[0].TradeType,
			s.Trades[0].Price != olds.Trades[0].Price,
			s.Trades[0].Tid != olds.Trades[0].Tid,
			s.Trades[0].Amount != olds.Trades[0].Amount:
			sd.Trade = &s.Trades[0]
			write = true
		}
	}
	if write {
		sl = append(sl, sd)
		for len(sl) > StoreDataMax {
			sl[0] = StoreData{} // どうせ使わないのでGCのためにメモリゼロ化
			sl = sl[1:]
		}
	}
	return sl, write
}

func (h *OldStreamHandler) getStoreData(ctx context.Context, name string) ([]StoreData, error) {
	ch := make(chan Result, 1)
	tctx, cancel := context.WithTimeout(ctx, time.Second*5)
	defer func() {
		cancel()
		close(ch)
	}()
	req := Request{
		name: name,
		filter: func(s []StoreData) []StoreData {
			return s
		},
		wch: ch,
	}

	select {
	case <-tctx.Done():
		return nil, errors.New("timeout")
	case h.reqch <- req:
		// リクエスト送信
	}

	var it Result
	select {
	case <-tctx.Done():
		return nil, errors.New("timeout")
	case it = <-ch:
		// 結果の受信
	}
	if it.err != nil {
		log.Warnw("ストリームデータの取得に失敗しました。", "error", it.err, "name", name)
	}
	return it.sl, nil
}

func (h *OldStreamHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	p := r.URL.Path
	_, file := path.Split(p)
	sdl, err := h.getStoreData(r.Context(), file)
	if err == nil {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		err = json.NewEncoder(w).Encode(sdl)
		if err != nil {
			log.Warnw("JSON出力に失敗しました。", "error", err, "path", p)
		}
	} else {
		http.NotFound(w, r)
	}
}

func (h *GetMonitoringHandler) getResultMonitor(ctx context.Context) (ResultMonitor, error) {
	var res ResultMonitor
	resch := make(chan ResultMonitor, 1)
	cctx, cancel := context.WithTimeout(ctx, time.Second*5)
	defer func() {
		cancel()
		close(resch)
	}()
	select {
	case <-cctx.Done():
		return res, errors.New("timeout")
	case h.monich <- RequestMonitor{wch: resch}:
		// リクエスト送信
	}
	select {
	case <-cctx.Done():
		return res, errors.New("timeout")
	case res = <-resch:
		// 結果の受信
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
