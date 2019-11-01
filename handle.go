package zbbv

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"
)

type OldStreamHandler struct {
	cp string
	ch <-chan StoreDataArray
}
type LastPriceHandler struct {
	cp string
	ch <-chan LastPrice
}
type GetMonitoringHandler struct {
	ch <-chan ResultMonitor
}
type DepthHandler struct {
	cp string
	ch <-chan []byte
}
type TicksHandler struct {
	cp string
	ch <-chan []Ticker
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

func (h *OldStreamHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	sda, err := h.getStoreData(r.Context())
	if err == nil {
		defer sda.Close()
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		storeDataArrayToJSON(w, sda)
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
		log.Debugw("受信！ getLastPrice", "key", h.cp, "data", res)
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

func (h *DepthHandler) getDepth(ctx context.Context) ([]byte, error) {
	var data []byte
	c, cancel := context.WithTimeout(ctx, time.Second*3)
	defer cancel()
	select {
	case <-c.Done():
		return nil, errors.New("timeout")
	case data = <-h.ch:
		log.Debugw("受信！ getDepth", "key", h.cp)
	}
	return data, nil
}

func (h *DepthHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	data, err := h.getDepth(r.Context())
	if err == nil {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_, err := w.Write(data)
		if err != nil {
			log.Warnw("JSON出力に失敗しました。", "error", err, "path", r.URL.Path)
		}
	} else {
		http.Error(w, "データ取得に失敗しました。", http.StatusInternalServerError)
	}
}

func (h *TicksHandler) getTick(ctx context.Context) ([]Ticker, error) {
	var tcl []Ticker
	c, cancel := context.WithTimeout(ctx, time.Second*3)
	defer cancel()
	select {
	case <-c.Done():
		return nil, errors.New("timeout")
	case tcl = <-h.ch:
		log.Debugw("受信！ getTick", "key", h.cp)
	}
	return tcl, nil
}

func (h *TicksHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	tcl, err := h.getTick(r.Context())
	if err == nil {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		err := json.NewEncoder(w).Encode(tcl)
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
		log.Debugw("受信！ getResultMonitor", "data", res)
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
