package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math/rand"
	"net/http"
	"strconv"
	"time"

	"github.com/gorilla/websocket"
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
	t, err := time.Parse(`"2006-01-02 15:04:05.000000"`, string(data))
	*ts = Timestamp(t)
	return err
}
func (ts Timestamp) MarshalJSON() ([]byte, error) {
	buf := make([]byte, 0, 12)
	buf = append(buf, '"')
	buf = strconv.AppendInt(buf, time.Time(ts).Unix(), 10)
	buf = append(buf, '"')
	return buf, nil
}

type Stream struct {
	Asks         []PriceAmount `json:"asks"`
	Bids         []PriceAmount `json:"bids"`
	Trades       []Trade       `json:"trades"`
	Timestamp    Timestamp     `json:"timestamp"`
	LastPrice    LastPrice     `json:"last_price"`
	CurrentyPair string        `json:"currency_pair"`
}

type BBHandler struct {
	fs    http.Handler
	reqch chan<- Request
}

type StreamPacket struct {
	name string
	s    Stream
}
type Result struct {
	err error
	sl  []Stream
}
type Request struct {
	name   string
	filter func([]Stream) []Stream
	wch    chan<- Result
}

var zaifStremUrlList = map[string]string{
	"btc_jpy":  "wss://ws.zaif.jp/stream?currency_pair=btc_jpy",
	"xem_jpy":  "wss://ws.zaif.jp/stream?currency_pair=xem_jpy",
	"mona_jpy": "wss://ws.zaif.jp/stream?currency_pair=mona_jpy",
	"bch_jpy":  "wss://ws.zaif.jp/stream?currency_pair=bch_jpy",
	"eth_jpy":  "wss://ws.zaif.jp/stream?currency_pair=eth_jpy",
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
	for key, u := range zaifStremUrlList {
		go func(wss, key string, wsch chan<- StreamPacket) {
			wait := (time.Duration(rand.Uint64()%3000) * time.Millisecond) + (2 * time.Second)
			for {
				time.Sleep(wait)
				log.Println(wss, "接続")
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
						s.Bids = s.Bids[:1]
						s.Asks = s.Asks[:1]
						s.Trades = s.Trades[:1]
						wsch <- StreamPacket{
							name: key,
							s:    s,
						}
					}
					return nil
				}()
				if err != nil {
					log.Println(err)
				} else {
					log.Println(wss, "正常終了")
				}
				if wait < 180*time.Second {
					wait *= 2
				}
			}
		}(u, key, sch)
	}
	go func(rsch <-chan StreamPacket, reqch <-chan Request) {
		slm := make(map[string][]Stream, 8)
		for {
			select {
			case it := <-rsch:
				slm[it.name] = appendStream(slm[it.name], it.s)
			case it := <-reqch:
				if sl, ok := slm[it.name]; ok {
					if it.filter != nil {
						sl = it.filter(sl[:])
					}
					it.wch <- Result{
						err: nil,
						sl:  sl,
					}
				} else {
					it.wch <- Result{
						err: errors.New("nil"),
					}
				}
			}
		}
	}(sch, reqch)
	// サーバ起動
	fmt.Println(server.ListenAndServe())
}

func appendStream(sl []Stream, s Stream) []Stream {
	sl = append(sl, s)
	return sl
}

func (bbh *BBHandler) getStream(name string) []Stream {
	ch := make(chan Result, 1)
	bbh.reqch <- Request{
		name: name,
		filter: func(s []Stream) []Stream {
			if len(s) > 100 {
				return s[len(s)-100:]
			}
			return s
		},
		wch: ch,
	}
	it := <-ch
	return it.sl
}

func (bbh *BBHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	switch r.URL.Path {
	case "/btc_jpy":
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		json.NewEncoder(w).Encode(bbh.getStream("btc_jpy"))
	case "/xem_jpy":
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		json.NewEncoder(w).Encode(bbh.getStream("xem_jpy"))
	case "/mona_jpy":
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		json.NewEncoder(w).Encode(bbh.getStream("mona_jpy"))
	case "/bch_jpy":
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		json.NewEncoder(w).Encode(bbh.getStream("bch_jpy"))
	case "/eth_jpy":
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		json.NewEncoder(w).Encode(bbh.getStream("eth_jpy"))
	default:
		// その他
		bbh.fs.ServeHTTP(w, r)
	}
}
