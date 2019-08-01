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
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/NYTimes/gziphandler"
	"github.com/gorilla/websocket"
	"go.uber.org/zap"
	"golang.org/x/crypto/acme/autocert"
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
type BBHandler struct {
	fs    http.Handler
	reqch chan<- Request
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
}

func main() {
	rand.Seed(time.Now().UnixNano())
	reqch := make(chan Request, 8)
	sch := make(chan StreamPacket, 32)
	storesch := make(chan StoreDataPacket, 32)
	pctx := startSignalProc(context.Background())
	for key, u := range zaifStremUrlList {
		go streamReaderProc(pctx, u, key, sch)
	}
	go streamStoreProc(pctx, sch, storesch, reqch)
	go storeWriterProc(pctx, storesch)

	nh := BBHandler{
		fs:    http.FileServer(http.Dir("./public_html")),
		reqch: reqch,
	}
	gnh := gziphandler.MustNewGzipLevelHandler(gzip.BestSpeed)(&nh)
	serverLocal := &http.Server{
		Addr:    ":8080",
		Handler: gnh,
	}
	server := &http.Server{
		Handler: gnh,
	}
	// サーバ起動
	go serverLocal.ListenAndServe()
	log.Fatal(server.Serve(autocert.NewListener("crypto.unko.in")))
}

func startSignalProc(ctx context.Context) context.Context {
	pctx, cancelParent := context.WithCancel(ctx)
	go func() {
		defer cancelParent()
		sig := make(chan os.Signal, 1)
		signal.Notify(sig,
			syscall.SIGHUP,
			syscall.SIGINT,
			syscall.SIGTERM,
			syscall.SIGQUIT,
		)
		defer signal.Stop(sig)

		select {
		case <-pctx.Done():
			log.Infow("Cancel from parent")
		case s := <-sig:
			switch s {
			case syscall.SIGHUP, syscall.SIGINT, syscall.SIGTERM, syscall.SIGQUIT:
				log.Infow("Signal!!", "signal", s)
			}
		}
	}()
	return pctx
}

func streamReaderProc(ctx context.Context, wss, key string, wsch chan<- StreamPacket) {
	cctx, cancel := context.WithCancel(ctx)
	defer cancel()
	wait := time.Duration(rand.Uint64()%5000) * time.Millisecond
	for {
		time.Sleep(wait)
		log.Infow("Websoket接続", "path", wss)
		err := func() error {
			ccctx, cancelChild := context.WithCancel(cctx)
			defer cancelChild()
			con, _, err := websocket.DefaultDialer.DialContext(ccctx, wss, nil)
			if err != nil {
				return err
			}
			defer con.Close()
			for {
				s := Stream{}
				err = con.ReadJSON(&s)
				if err != nil {
					return err
				}
				wsch <- StreamPacket{
					name: key,
					s:    s,
				}
			}
		}()
		if IsCancel(cctx) {
			log.Infow("streamReaderProc終了")
			return
		}
		if err != nil {
			log.Infow("websocket通信に失敗しました。", "error", err, "url", wss, "key", key)
		} else {
			log.Infow("websocket通信が正常終了しました。", "url", wss, "key", key)
		}
		if wait < 180*time.Second {
			wait *= 2
			wait += time.Duration(rand.Uint64() % 5000)
		}
	}
}

func streamStoreProc(ctx context.Context, rsch <-chan StreamPacket, wsch chan<- StoreDataPacket, reqch <-chan Request) {
	cctx, cancel := context.WithCancel(ctx)
	defer cancel()
	slm := make(map[string][]StoreData, 8)
	oldstream := make(map[string]Stream, 8)
	now := time.Now()
	for key := range zaifStremUrlList {
		sl, err := storeReaderProc(now, key)
		if err != nil {
			log.Infow("ファイル読み込み失敗", "error", err)
		}
		slm[key] = sl
	}
	for {
		select {
		case <-cctx.Done():
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
	sl := []StoreData{}
	scanner := bufio.NewScanner(sir)
	for scanner.Scan() {
		sd := StoreData{}
		err := json.Unmarshal(scanner.Bytes(), &sd)
		if err != nil {
			log.Infow("JSON解析失敗", "error", err, "json", scanner.Text())
			continue
		}
		sl = append(sl, sd)
	}
	return sl, nil
}

func storeWriterProc(ctx context.Context, rsch <-chan StoreDataPacket) {
	cctx, cancel := context.WithCancel(ctx)
	defer cancel()
	old := time.Now()
	tc := time.NewTicker(time.Second)
	m := make(map[string]*StoreItem, 8)
	for {
		select {
		case <-cctx.Done():
			for _, it := range m {
				it.Close()
			}
			log.Infow("storeWriterProc終了")
			log.Sync()
			os.Exit(1)
			return
		case it := <-rsch:
			si, ok := m[it.name]
			if !ok {
				var err error
				si, err = NewStoreItem(old, it.name)
				if err != nil {
					log.Infow("JSONファイル生成に失敗しました。", "error", err, "name", it.name)
					break
				}
				_ = si.readData()
				m[it.name] = si
			}
			err := json.NewEncoder(si.w).Encode(it.sd)
			if err != nil {
				log.Infow("JSONファイル出力に失敗しました。", "error", err)
			}
		case now := <-tc.C:
			if now.Day() != old.Day() {
				for key, it := range m {
					it.Close()
					err := it.reset(now, key)
					if err != nil {
						log.Infow("JSONファイル生成に失敗しました。", "error", err, "name", key)
						break
					}
				}
				old = now
			}
			if uint64(now.Unix())%30 == 0 {
				// 定期的に保存する
				for _, it := range m {
					it.Flush()
				}
			}
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

func IsCancel(ctx context.Context) (ret bool) {
	select {
	case <-ctx.Done():
		ret = true
	default:
		ret = false
	}
	return
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
		for len(sl) > 4096 {
			sl = sl[1:]
		}
	}
	return sl, write
}

func (bbh *BBHandler) getStoreData(name string) []StoreData {
	ch := make(chan Result, 1)
	bbh.reqch <- Request{
		name: name,
		filter: func(s []StoreData) []StoreData {
			return s
		},
		wch: ch,
	}
	it := <-ch
	if it.err != nil {
		log.Infow("ストリームデータの取得に失敗しました。", "error", it.err, "name", name)
	}
	return it.sl
}

func (bbh *BBHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	switch {
	case strings.Index(r.URL.Path, "/api/zaif/1/oldstream/") == 0:
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		err := json.NewEncoder(w).Encode(bbh.getStoreData(strings.TrimLeft(r.URL.Path, "/api/zaif/1/oldstream/")))
		if err != nil {
			log.Infow("JSON出力に失敗しました。", "error", err, "path", r.URL.Path)
		}
	default:
		// その他
		bbh.fs.ServeHTTP(w, r)
	}
}
