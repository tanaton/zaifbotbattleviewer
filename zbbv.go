package zbbv

import (
	"compress/gzip"
	"context"
	"errors"
	"fmt"
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
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"golang.org/x/crypto/acme/autocert"
	"gopkg.in/natefinch/lumberjack.v2"
)

const RootDomain = "crypto.unko.in"

const (
	StoreDataMax  = 1 << 14 // 16384
	ZaifStremUrl  = "wss://ws.zaif.jp/stream?currency_pair="
	ZaifDepthUrl  = "https://api.zaif.jp/api/1/depth/"
	ZaifTickerUrl = "https://api.zaif.jp/api/1/ticker/"
	AccessLogPath = "./log"
	RootDataPath  = "data"
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
	return strconv.AppendInt([]byte(nil), time.Time(ts).Unix(), 10), nil
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
type Srv struct {
	s *http.Server
	f func(s *http.Server) error
}

type App struct {
	wg sync.WaitGroup
}

var gzipContentTypeList = []string{
	"text/html",
	"text/css",
	"text/javascript",
	"text/plain",
	"application/json",
}
var zaifStremURLList = []string{
	"btc_jpy",
	"xem_jpy",
	"mona_jpy",
	"bch_jpy",
	"eth_jpy",
}
var bufferPool = sync.Pool{
	New: func() interface{} {
		return make([]byte, 0, 32*1024)
	},
}
var log *zap.SugaredLogger

func init() {
	//logger, err := zap.NewDevelopment()
	logger, err := zap.NewProduction()
	if err != nil {
		panic(err)
	}
	log = logger.Sugar()
	rand.Seed(time.Now().UnixNano())
}

func New() *App {
	return &App{}
}

func (app *App) Run(ctx context.Context) error {
	ctx, exitch := app.startExitManageProc(ctx)

	for _, key := range zaifStremURLList {
		sdch := make(chan StoreDataArray)
		lpch := make(chan LastPrice)
		depthch := make(chan []byte)
		sch := make(chan Stream, 8)
		storesch := make(chan StoreData, 256)
		tch := make(chan []Ticker)
		app.wg.Add(1)
		go app.streamReaderProc(ctx, key, sch)
		app.wg.Add(1)
		go app.streamStoreProc(ctx, key, sch, storesch, sdch, lpch)
		app.wg.Add(1)
		go app.storeWriterProc(ctx, key, storesch)
		app.wg.Add(1)
		go app.getDepthProc(ctx, key, depthch)
		app.wg.Add(1)
		go app.getTickerProc(ctx, key, tch)
		// URL設定
		http.Handle("/api/zaif/1/oldstream/"+key, &OldStreamHandler{cp: key, ch: sdch})
		http.Handle("/api/zaif/1/lastprice/"+key, &LastPriceHandler{cp: key, ch: lpch})
		http.Handle("/api/zaif/1/depth/"+key, &DepthHandler{cp: key, ch: depthch})
		http.Handle("/api/zaif/1/ticks/"+key, &TicksHandler{cp: key, ch: tch})
	}

	monich := make(chan ResultMonitor)
	rich := make(chan ResponseInfo, 32)

	app.wg.Add(1)
	go app.serverMonitoringProc(ctx, rich, monich)

	// URL設定
	http.Handle("/api/unko.in/1/monitor", &GetMonitoringHandler{ch: monich})
	http.Handle("/", http.FileServer(http.Dir("./public_html")))

	ghfunc, err := gziphandler.GzipHandlerWithOpts(gziphandler.CompressionLevel(gzip.BestSpeed), gziphandler.ContentTypes(gzipContentTypeList))
	if err != nil {
		exitch <- struct{}{}
		log.Infow("サーバーハンドラの作成に失敗しました。", "error", err)
		return app.shutdown(ctx)
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
			f: func(s *http.Server) error { return s.Serve(autocert.NewListener(RootDomain)) },
		},
	}
	for _, s := range sl {
		s := s // ローカル化
		app.wg.Add(1)
		go s.startServer(&app.wg)
	}
	// シャットダウン管理
	return app.shutdown(ctx, sl...)
}

func (srv Srv) startServer(wg *sync.WaitGroup) {
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

func (app *App) shutdown(ctx context.Context, sl ...Srv) error {
	// シグナル等でサーバを中断する
	<-ctx.Done()
	// シャットダウン処理用コンテキストの用意
	sctx, scancel := context.WithCancel(context.Background())
	defer scancel()
	for _, srv := range sl {
		app.wg.Add(1)
		go func(srv *http.Server) {
			ssctx, sscancel := context.WithTimeout(sctx, time.Second*10)
			defer func() {
				sscancel()
				app.wg.Done()
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
	app.wg.Wait()
	return log.Sync()
}

func (app *App) startExitManageProc(ctx context.Context) (context.Context, chan<- struct{}) {
	exitch := make(chan struct{}, 1)
	ectx, cancel := context.WithCancel(ctx)
	app.wg.Add(1)
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
			app.wg.Done()
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

func (app *App) streamReaderProc(ctx context.Context, key string, wsch chan<- Stream) {
	defer app.wg.Done()
	wait := time.Duration(rand.Uint64()%5000) * time.Millisecond
	wss := ZaifStremUrl + key
	for {
		time.Sleep(wait)
		exit := func() (exit bool) {
			ch := make(chan error, 1)
			dialctx, dialcancel := context.WithTimeout(ctx, time.Second*7)
			defer dialcancel()
			defer close(ch) // 複数回作成される可能性があるためクローズしておく
			con, _, dialerr := websocket.DefaultDialer.DialContext(dialctx, wss, nil)
			if dialerr != nil {
				// Dialが失敗した理由がよくわからない
				// contextを伝搬してきた通知で失敗した？普通にタイムアウトした？
				// 先の処理に丸投げ
				ch <- dialerr
			} else {
				defer con.Close()
				log.Infow("Websoket接続開始", "path", wss)
				app.wg.Add(1)
				go func() {
					defer app.wg.Done()
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
				log.Warnw("websocket通信が切断されました。", "error", err, "url", wss)
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
			wait += time.Duration(rand.Uint64()%5000) * time.Millisecond
		}
	}
}

func (app *App) streamStoreProc(ctx context.Context, key string, rsch <-chan Stream, wsch chan<- StoreData, sdch chan<- StoreDataArray, lpch chan<- LastPrice) {
	defer app.wg.Done()
	oldstream := Stream{}
	sda, err := streamBufferReadProc(key)
	if err != nil {
		log.Warnw("バッファの読み込みに失敗しました。", "error", err, "key", key)
	}
	sdatmp := sda.Copy()
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
			sd, ok := streamToStoreData(s, oldstream)
			oldstream = s
			if ok {
				sda.Push(sd)
				sdatmp.Push(sd)
				select {
				case wsch <- sd:
					log.Debugw("送信！ streamStoreProc -> storeWriterProc", "key", key, "data", sd)
				default:
					// 送信できなかったらすぐに諦める
				}
			}
		case sdch <- sdatmp:
			sdatmp = sda.Copy()
		case lpch <- oldstream.LastPrice:
		}
	}
}

func (app *App) storeWriterProc(ctx context.Context, key string, rsch <-chan StoreData) {
	defer app.wg.Done()
	old := time.Now()
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
			var err error
			if si == nil {
				si, err = newStoreItem(date, key)
				if err != nil {
					log.Warnw("JSONファイル生成に失敗しました。", "error", err, "name", key)
					break
				}
			} else if date.Day() != old.Day() {
				err = si.nextFile(date)
				if err != nil {
					log.Warnw("JSONファイル生成に失敗しました。", "error", err, "name", key)
					break
				}
			}
			old = date
			err = si.writeJsonLine(sd)
			if err != nil {
				log.Warnw("JSONファイル出力に失敗しました。", "error", err)
				break
			}
		}
	}
}

func (app *App) getTickerProc(ctx context.Context, key string, tch chan<- []Ticker) {
	defer app.wg.Done()
	dir := filepath.Join(RootDataPath, "tick", key)
	tcl := readTicks(dir)
	old := time.Now()
	t := time.NewTicker(time.Minute)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			log.Infow("getTickerProc終了", "key", key)
			return
		case now := <-t.C:
			if now.Day() != old.Day() {
				tc, err := getTicker(ctx, key)
				if err != nil {
					break
				}
				p := filepath.Join(dir, fmt.Sprintf("%s_%s.json", old.Format("20060102"), key))
				tcl = append(tcl, *tc)
				createTickJSONFile(p, tc)
			}
			old = now
		case tch <- copyTicks(tcl):
		}
	}
}

// サーバお手軽監視用
func (app *App) serverMonitoringProc(ctx context.Context, rich <-chan ResponseInfo, monich chan<- ResultMonitor) {
	defer app.wg.Done()
	// logrotateの設定がめんどくせーのでアプリでやる
	// https://github.com/uber-go/zap/blob/master/FAQ.md
	logger := zap.New(zapcore.NewCore(
		zapcore.NewJSONEncoder(zap.NewProductionEncoderConfig()),
		zapcore.AddSync(&lumberjack.Logger{
			Filename:   filepath.Join(AccessLogPath, "access.log"),
			MaxSize:    100, // megabytes
			MaxBackups: 100,
			MaxAge:     7,    // days
			Compress:   true, // disabled by default
		}),
		zap.InfoLevel,
	))
	defer logger.Sync()
	res := ResultMonitor{}
	resmin := ResultMonitor{}
	tc := time.NewTicker(time.Minute)
	defer tc.Stop()
	for {
		select {
		case <-ctx.Done():
			log.Infow("serverMonitoringProc終了")
			return
		case monich <- resmin:
		case ri := <-rich:
			ela := ri.end.Sub(ri.start)
			res.ResponseCount++
			res.ResponseTimeSum += ela
			if ri.status < 400 {
				res.ResponseCodeOkCount++
			} else {
				res.ResponseCodeNgCount++
			}
			// アクセスログ出力
			logger.Info("-",
				zap.String("addr", ri.addr),
				zap.String("host", ri.host),
				zap.String("method", ri.method),
				zap.String("uri", ri.uri),
				zap.String("protocol", ri.protocol),
				zap.Int("status", ri.status),
				zap.Int("size", ri.size),
				zap.String("ua", ri.userAgent),
				zap.Duration("elapse", ela),
			)
		case <-tc.C:
			resmin = res
			res = ResultMonitor{}
		}
	}
}

func (app *App) getDepthProc(ctx context.Context, key string, depthch chan<- []byte) {
	defer app.wg.Done()
	data, err := getDepth(ctx, key)
	if err != nil {
		data = []byte{'{', '}'}
	}
	tc := time.NewTicker(time.Second * 30)
	defer tc.Stop()
	for {
		select {
		case <-ctx.Done():
			log.Infow("getDepthProc終了", "key", key)
			return
		case <-tc.C:
			buf, err := getDepth(ctx, key)
			if err == nil {
				data = buf
			}
		case depthch <- copyByteSlice(data):
		}
	}
}

func getDepth(ctx context.Context, key string) ([]byte, error) {
	c, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(c, http.MethodGet, ZaifDepthUrl+key, nil)
	if err != nil {
		return nil, err
	}
	resp, err := http.DefaultClient.Do(req)
	if err == nil {
		defer resp.Body.Close()
		data, err := ioutil.ReadAll(resp.Body)
		if err != nil {
			return nil, err
		}
		return data, nil
	}
	return nil, err
}

func copyByteSlice(data []byte) []byte {
	// 配列のゼロクリアを省略する最適化が入っているらしいので
	// https://github.com/golang/go/issues/26252
	return append([]byte(nil), data...)
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

func createStoreFilePath(date time.Time, key, cate string) string {
	return filepath.Join(RootDataPath, cate, key, fmt.Sprintf("%s_%s.json", key, date.Format("20060102")))
}

func createBufferFilePath(key string) string {
	return filepath.Join(RootDataPath, "tmp", fmt.Sprintf("%s_buffer.gob", key))
}
