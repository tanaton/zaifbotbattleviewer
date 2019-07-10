package main

import (
	"bufio"
	"compress/gzip"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/rand"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/gorilla/websocket"
	"go.uber.org/zap"
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
	nh := BBHandler{
		fs:    http.FileServer(http.Dir("./public_html")),
		reqch: reqch,
	}
	server := &http.Server{
		Addr:    ":8080",
		Handler: &nh,
	}
	sch := make(chan StreamPacket, 32)
	storesch := make(chan StoreDataPacket, 32)
	for key, u := range zaifStremUrlList {
		go func(wss, key string, wsch chan<- StreamPacket) {
			wait := time.Duration(rand.Uint64()%5000) * time.Millisecond
			for {
				time.Sleep(wait)
				log.Infow("Websoket接続", "path", wss)
				err := func() error {
					con, _, err := websocket.DefaultDialer.Dial(wss, nil)
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
			}
		}(u, key, sch)
	}
	go func(rsch <-chan StreamPacket, wsch chan<- StoreDataPacket, reqch <-chan Request) {
		slm := make(map[string][]StoreData, 8)
		oldstream := make(map[string]Stream, 8)
		now := time.Now()
		for key, _ := range zaifStremUrlList {
			err := func(key string) error {
				p := createStoreFilePath(now, key)
				fp, err := os.Open(p)
				if err != nil {
					return err
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
				slm[key] = sl
				return nil
			}(key)
			if err != nil {
				log.Infow("ファイル読み込み失敗", "error", err)
			}
		}
		for {
			select {
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
	}(sch, storesch, reqch)
	go func(rsch <-chan StoreDataPacket) {
		old := time.Now()
		tc := time.NewTicker(time.Second)
		m := make(map[string]StoreItem, 8)
		for {
			select {
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
						w:    bufio.NewWriter(fp),
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
			}
		}
	}(storesch)

	// サーバ起動
	log.Fatal(server.ListenAndServe())
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
		out := HtmlOutputParam("application/json; charset=utf-8")
		wc, sw := PreOutput(w, r, out)
		defer wc.Close()
		err := json.NewEncoder(wc).Encode(bbh.getStoreData(r.URL.Path[17:]))
		if err != nil {
			log.Infow("JSON出力に失敗しました。", "error", err, "path", r.URL.Path, "size", sw.Size())
		}
	default:
		// その他
		bbh.fs.ServeHTTP(w, r)
	}
}

func Print(resw http.ResponseWriter, r *http.Request, out Output) int {
	wc, sw := PreOutput(resw, r, out)
	defer wc.Close()
	// ボディ出力
	if r.Method != "HEAD" && out.Reader != nil {
		io.Copy(wc, out.Reader)
	}
	return sw.Size()
}

func PreOutput(resw http.ResponseWriter, r *http.Request, out Output) (io.WriteCloser, Size) {
	// ヘッダー設定
	for key, _ := range out.Header {
		resw.Header().Set(key, out.Header.Get(key))
	}
	resw.Header().Set("X-Frame-Options", "deny")

	// 出力フォーマット切り替え
	var wc io.WriteCloser
	sw := NewSizeCountWriter(resw)
	if out.ZFlag {
		resw.Header().Set("Vary", "Accept-Encoding")
		if strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
			// gzip圧縮
			resw.Header().Set("Content-Encoding", "gzip")
			wc, _ = gzip.NewWriterLevel(sw, gzip.BestSpeed)
		} else {
			// 圧縮しない
			wc = sw
		}
	} else {
		// 生データ
		wc = sw
	}
	// ステータスコード＆ヘッダー出力
	resw.WriteHeader(out.Code)
	return wc, sw
}

func HtmlOutputParam(ct string) Output {
	h := http.Header{}
	h.Set("Content-Type", ct)
	return Output{
		Code:   200,
		Header: h,
		ZFlag:  true,
	}
}

type Size interface {
	Size() int
}

type sizeCountWriter struct {
	w io.Writer
	s int
}

func NewSizeCountWriter(w io.Writer) *sizeCountWriter {
	return &sizeCountWriter{w: w}
}

func (scw *sizeCountWriter) Write(p []byte) (n int, err error) {
	n, err = scw.w.Write(p)
	scw.s += n
	return
}
func (_ *sizeCountWriter) Close() error {
	return nil
}
func (scw *sizeCountWriter) Size() int {
	return scw.s
}
