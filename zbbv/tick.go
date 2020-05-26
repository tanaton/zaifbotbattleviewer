package zbbv

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"time"
)

type ZaifTicker struct {
	Last   float64 `json:"last"`   // 終値
	High   float64 `json:"high"`   // 過去24時間の高値
	Low    float64 `json:"low"`    // 過去24時間の安値
	Vwap   float64 `json:"vwap"`   // 過去24時間の加重平均
	Volume float64 `json:"volume"` // 過去24時間の出来高
	Bid    float64 `json:"bid"`    // 買気配値
	Ask    float64 `json:"ask"`    // 売気配値
}

type Ticker struct {
	Date   string  `json:"date"`   // 日付
	Open   float64 `json:"open"`   // 始値
	Close  float64 `json:"close"`  // 終値
	High   float64 `json:"high"`   // 過去24時間の高値
	Low    float64 `json:"low"`    // 過去24時間の安値
	Vwap   float64 `json:"vwap"`   // 過去24時間の加重平均
	Volume float64 `json:"volume"` // 過去24時間の出来高
}

func getZaifTicker(ctx context.Context, key string) (*ZaifTicker, error) {
	c, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(c, http.MethodGet, ZaifTickerUrl+key, nil)
	if err != nil {
		return nil, err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	var tc ZaifTicker
	err = json.NewDecoder(resp.Body).Decode(&tc)
	return &tc, err
}

func copyTicks(tcl []Ticker) []Ticker {
	return append([]Ticker(nil), tcl...)
}

func createZaifTickJSONFile(p string, tc *ZaifTicker) {
	direrr := createDir(p)
	if direrr != nil {
		log.Warnw("フォルダ作成に失敗しました。", "error", direrr, "path", p)
		return
	}
	wfp, err := os.Create(p)
	if err != nil {
		log.Warnw("ファイル作成に失敗しました。", "error", err, "path", p)
		return
	}
	defer wfp.Close()
	err = json.NewEncoder(wfp).Encode(tc)
	if err != nil {
		log.Warnw("JSON出力に失敗しました。", "error", err, "path", p)
		return
	}
	err = wfp.Sync()
	if err != nil {
		log.Warnw("JSON出力に失敗しました。", "error", err, "path", p)
		return
	}
}

func readTicks(dir string) []Ticker {
	tl := make([]Ticker, 0, 365)
	match, err := filepath.Glob(filepath.Join(dir, "*.json"))
	if len(match) > 0 && err == nil {
		// 昇順
		sort.Slice(match, func(i, j int) bool { return match[i] < match[j] })
		var old ZaifTicker
		for _, p := range match {
			_, file := filepath.Split(p)
			if len(file) <= 13 {
				continue
			}
			zt, err := readZaifTickData(p)
			if err != nil {
				break
			}
			if old.Last == 0 {
				old.Last = zt.Last
			}
			t := Ticker{
				Date:   file[0:8],
				Open:   old.Last,
				Close:  zt.Last,
				High:   zt.High,
				Low:    zt.Low,
				Vwap:   zt.Vwap,
				Volume: zt.Volume,
			}
			tl = append(tl, t)
			old = *zt
		}
	}
	return tl
}

func readZaifTickData(p string) (*ZaifTicker, error) {
	fp, err := os.Open(p)
	if err != nil {
		return nil, err
	}
	defer fp.Close()
	var tc ZaifTicker
	err = json.NewDecoder(fp).Decode(&tc)
	if err != nil {
		return nil, err
	}
	return &tc, nil
}
