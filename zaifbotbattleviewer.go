package main

import (
	"fmt"
	"net/http"
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

type Stream struct {
	Asks         []PriceAmount `json:"asks"`
	Bids         []PriceAmount `json:"bids"`
	Trades       []Trade       `json:"trades"`
	Timestamp    string        `json:"timestamp"`
	LastPrice    LastPrice     `json:"last_price"`
	CurrentyPair string        `json:"currenty_pair"`
}

type NemHandler struct {
	fs http.Handler
}

func main() {
	//	sch := make(chan Stream, 16)
	nh := NemHandler{
		fs: http.FileServer(http.Dir("./public_html")),
	}
	server := &http.Server{
		Addr:    ":8080",
		Handler: &nh,
	}
	//	go Analyze(sch)
	//	go ZaifReceiver(sch)
	// サーバ起動
	fmt.Println(server.ListenAndServe())
}

func (nh *NemHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	switch r.URL.Path {
	//case "", "/", "/index.html":
	default:
		// その他
		nh.fs.ServeHTTP(w, r)
	}
}

func Analyze(sch <-chan Stream) {
	for s := range sch {
		fmt.Println(s)
	}
}

func ZaifReceiver(sch chan<- Stream) {
	for {
		fmt.Println(GetStrem(sch))
		time.Sleep(5 * time.Second)
	}
}

func GetStrem(sch chan<- Stream) error {
	con, _, err := websocket.DefaultDialer.Dial("wss://ws.zaif.jp/stream?currency_pair=xem_jpy", nil)
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
		sch <- s
	}
}
