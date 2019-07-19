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
	name string
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
	ctx := context.Background()
	pctx := startSignalProc(ctx)
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
	wait := time.Duration(rand.Uint64()%5000) * time.Millisecond
	for {
		time.Sleep(wait)
		log.Infow("Websoket接続", "path", wss)
		err := func() error {
			child, cancelChild := context.WithCancel(ctx)
			defer cancelChild()
			con, _, err := websocket.DefaultDialer.DialContext(child, wss, nil)
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
			return nil
		}()
		if err != nil {
			log.Infow("websocket通信に失敗しました。", "error", err, "url", wss, "key", key)
		} else {
			log.Infow("websocket通信が正常終了しました。", "url", wss, "key", key)
		}
		if wait < 180*time.Second {
			wait *= 2
			wait += time.Duration(rand.Uint64() % 5000)
		}
		select {
		case <-ctx.Done():
			log.Infow("streamReaderProc終了")
			return
		default:
		}
	}
}

func streamStoreProc(ctx context.Context, rsch <-chan StreamPacket, wsch chan<- StoreDataPacket, reqch <-chan Request) {
	slm := make(map[string][]StoreData, 8)
	oldstream := make(map[string]Stream, 8)
	now := time.Now()
	for key, _ := range zaifStremUrlList {
		sl, err := storeReaderProc(now, key)
		if err != nil {
			log.Infow("ファイル読み込み失敗", "error", err)
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
	p := createStoreFilePath(now, key)
	fp, err := os.Open(p)
	if err != nil {
		return nil, err
	}
	defer fp.Close()
	sl := []StoreData{}
	scanner := bufio.NewScanner(fp)
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
	old := time.Now()
	tc := time.NewTicker(time.Second)
	m := make(map[string]StoreItem, 8)
	for {
		select {
		case <-ctx.Done():
			for _, it := range m {
				it.w.Flush()
				it.fp.Close()
			}
			log.Infow("storeWriterProc終了")
			return
		case it := <-rsch:
			si, ok := m[it.name]
			if !ok {
				p := createStoreFilePath(old, it.name)
				fp, err := os.OpenFile(p, os.O_CREATE|os.O_APPEND|os.O_RDWR, 0666)
				if err != nil {
					log.Infow("JSONファイル生成に失敗しました。", "error", err, "path", p)
				}
				si = StoreItem{
					name: it.name,
					w:    bufio.NewWriterSize(fp, 16*1024),
					fp:   fp,
				}
				m[it.name] = si
			}
			err := json.NewEncoder(si.w).Encode(it.sd)
			if err != nil {
				log.Infow("JSONファイル出力に失敗しました。", "error", err)
			}
		case now := <-tc.C:
			if now.Day() != old.Day() {
				for key, it := range m {
					it.w.Flush()
					it.fp.Close()
					p := createStoreFilePath(now, key)
					fp, err := os.Create(p)
					if err != nil {
						log.Infow("JSONファイル生成に失敗しました。", "error", err, "path", p)
					}
					it.fp = fp
					it.w.Reset(fp)
					m[key] = it
				}
				old = now
			}
			if uint64(now.Unix())%30 == 0 {
				// 定期的に保存する
				for _, it := range m {
					it.w.Flush()
				}
			}
		}
	}
}

func createStoreFilePath(date time.Time, name string) string {
	return filepath.Join("data", fmt.Sprintf("%s_%s.json", date.Format("20060102"), name))
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
	switch r.URL.Path {
	case "/api/1/oldstream/btc_jpy", "/api/1/oldstream/xem_jpy", "/api/1/oldstream/mona_jpy", "/api/1/oldstream/bch_jpy", "/api/1/oldstream/eth_jpy":
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		err := json.NewEncoder(w).Encode(bbh.getStoreData(r.URL.Path[17:]))
		if err != nil {
			log.Infow("JSON出力に失敗しました。", "error", err, "path", r.URL.Path)
		}
	default:
		// その他
		bbh.fs.ServeHTTP(w, r)
	}
}
