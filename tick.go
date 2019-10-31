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

type Ticker struct {
	Last   float64 `json:"last"`   // 終値
	High   float64 `json:"high"`   // 過去24時間の高値
	Low    float64 `json:"low"`    // 過去24時間の安値
	Vwap   float64 `json:"vwap"`   // 過去24時間の加重平均
	Volume float64 `json:"volume"` // 過去24時間の出来高
	Bid    float64 `json:"bid"`    // 買気配値
	Ask    float64 `json:"ask"`    // 売気配値
}

func getTicker(ctx context.Context, key string) (*Ticker, error) {
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
	var tc Ticker
	err = json.NewDecoder(resp.Body).Decode(&tc)
	return &tc, err
}

func copyTicks(tcl []Ticker) []Ticker {
	return append([]Ticker(nil), tcl...)
}

func createTickJSONFile(p string, tc *Ticker) {
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
}

func readTicks(dir string) []Ticker {
	tcl := make([]Ticker, 0, 365)
	match, err := filepath.Glob(filepath.Join(dir, "*.json"))
	if len(match) > 0 && err == nil {
		// 降順
		sort.Slice(match, func(i, j int) bool { return match[i] > match[j] })
		for _, p := range match {
			tc, err := readTickData(p)
			if err != nil {
				break
			}
			tcl = append(tcl, *tc)
		}
		// 反転
		for i, j := 0, len(tcl)-1; i < j; i, j = i+1, j-1 {
			tcl[i], tcl[j] = tcl[j], tcl[i]
		}
	}
	return tcl
}

func readTickData(p string) (*Ticker, error) {
	fp, err := os.Open(p)
	if err != nil {
		return nil, err
	}
	defer fp.Close()
	var tc Ticker
	err = json.NewDecoder(fp).Decode(&tc)
	if err != nil {
		return nil, err
	}
	return &tc, nil
}
