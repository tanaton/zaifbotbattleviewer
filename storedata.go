package zbbv

import (
	"bufio"
	"compress/gzip"
	"encoding/gob"
	"io"
	"io/ioutil"
	"os"
	"strconv"
	"sync"
	"time"

	"github.com/tanaton/dtoa"
)

type StoreData struct {
	Ask       *PriceAmount `json:"ask,omitempty"`
	Bid       *PriceAmount `json:"bid,omitempty"`
	Trade     *Trade       `json:"trade,omitempty"`
	Timestamp Unixtime     `json:"ts"`
}
type StoreItem struct {
	date     time.Time
	name     string
	nonempty bool
	w        *bufio.Writer
	fp       *os.File
	buf      []byte
}
type StoreDataArray []StoreData

func streamBufferReadProc(key string) (StoreDataArray, error) {
	p := createBufferFilePath(key)
	rfp, err := os.Open(p)
	if err != nil {
		return nil, err
	}
	defer rfp.Close()
	sda := NewStoreDataArray()
	err = gob.NewDecoder(rfp).Decode(&sda)
	return sda, err
}

func streamBufferWriteProc(key string, sda StoreDataArray) error {
	p := createBufferFilePath(key)
	direrr := createDir(p)
	if direrr != nil {
		return direrr
	}
	wfp, err := os.Create(p)
	if err != nil {
		return err
	}
	defer wfp.Close()
	return gob.NewEncoder(wfp).Encode(sda)
}

func StoreDataToJSON(buf []byte, sd StoreData) []byte {
	buf = append(buf, '{')
	if sd.Ask != nil {
		buf = append(buf, `"ask":[`...)
		buf = dtoa.DtoaSimple(buf, sd.Ask[0], -1)
		buf = append(buf, ',')
		buf = dtoa.DtoaSimple(buf, sd.Ask[1], -1)
		buf = append(buf, `],`...)
	}
	if sd.Bid != nil {
		buf = append(buf, `"bid":[`...)
		buf = dtoa.DtoaSimple(buf, sd.Bid[0], -1)
		buf = append(buf, ',')
		buf = dtoa.DtoaSimple(buf, sd.Bid[1], -1)
		buf = append(buf, `],`...)
	}
	if sd.Trade != nil {
		buf = append(buf, `"trade":{"currenty_pair":"`...)
		buf = append(buf, sd.Trade.CurrentyPair...)
		buf = append(buf, `","trade_type":"`...)
		buf = append(buf, sd.Trade.TradeType...)
		buf = append(buf, `","price":`...)
		buf = dtoa.DtoaSimple(buf, sd.Trade.Price, -1)
		buf = append(buf, `,"tid":`...)
		buf = strconv.AppendUint(buf, sd.Trade.Tid, 10)
		buf = append(buf, `,"amount":`...)
		buf = dtoa.DtoaSimple(buf, sd.Trade.Amount, -1)
		buf = append(buf, `,"date":`...)
		buf = strconv.AppendUint(buf, sd.Trade.Date, 10)
		buf = append(buf, `},`...)
	}
	buf = append(buf, `"ts":`...)
	buf = strconv.AppendInt(buf, time.Time(sd.Timestamp).Unix(), 10)
	buf = append(buf, '}')
	return buf
}

func StoreDataArrayToJSON(w io.Writer, sda StoreDataArray) {
	buf := bufferPool.Get().([]byte)
	buf = append(buf, '[')
	for i, sd := range sda {
		if i > 0 {
			buf = append(buf, ',')
		}
		buf = StoreDataToJSON(buf, sd)
		if len(buf) > 16*1024 {
			w.Write(buf)
			buf = buf[:0]
		}
	}
	buf = append(buf, ']')
	w.Write(buf)
	bufferPool.Put(buf[:0])
}

func NewStoreItem(date time.Time, name string) (*StoreItem, error) {
	si := &StoreItem{}
	si.buf = make([]byte, 0, 16*1024)
	si.date = date
	si.name = name
	si.nonempty = false
	si.w = bufio.NewWriterSize(ioutil.Discard, 16*1024)
	p := si.createPathTmp()
	if err := createDir(p); err != nil {
		return nil, err
	}
	err := si.fileopen(p)
	return si, err
}

func (si *StoreItem) WriteJsonLine(sd StoreData) error {
	if si.nonempty {
		si.w.Write([]byte{',', '\n'})
	}
	si.buf = si.buf[:0]
	si.buf = StoreDataToJSON(si.buf, sd)
	_, err := si.w.Write(si.buf)
	si.nonempty = true
	return err
}

func (si *StoreItem) Close() error {
	si.w.Flush()
	err := si.fp.Close()
	si.fp = nil
	return err
}

func (si *StoreItem) fileopen(p string) error {
	st, err := os.Stat(p)
	if err != nil {
		fp, err := os.Create(p)
		if err != nil {
			return err
		}
		si.fp = fp
		si.w.Reset(si.fp)
		si.w.WriteByte('[')
		si.w.Flush() // JSONの正しさを保つために書き込みしておく
		si.nonempty = false
	} else {
		fp, err := os.OpenFile(p, os.O_CREATE|os.O_APPEND|os.O_RDWR, 0666)
		if err != nil {
			return err
		}
		si.fp = fp
		si.w.Reset(si.fp)
		si.nonempty = st.Size() > 2
	}
	return nil
}

func (si *StoreItem) nextFile(date time.Time) error {
	si.w.WriteByte(']')
	si.Close()
	si.store()
	si.date = date
	p := si.createPathTmp()
	return si.fileopen(p)
}

func (si *StoreItem) store() error {
	n := si.createPathStream()
	if err := createDir(n); err != nil {
		return err
	}
	o := si.createPathTmp()
	rfp, err := os.Open(o)
	if err != nil {
		return err
	}
	defer rfp.Close()
	wfp, err := os.Create(n)
	if err != nil {
		return err
	}
	defer wfp.Close()
	gz, _ := gzip.NewWriterLevel(wfp, gzip.BestSpeed)
	defer gz.Close()
	_, err = io.Copy(gz, rfp)
	return err
}

func (si *StoreItem) createPathTmp() string {
	return createStoreFilePath(si.date, si.name, "tmp")
}

func (si *StoreItem) createPathStream() string {
	return createStoreFilePath(si.date, si.name, "stream") + ".gz"
}

var storeDataArrayPool = sync.Pool{
	New: func() interface{} {
		return StoreDataArray(make([]StoreData, 0, StoreDataMax))
	},
}

func NewStoreDataArray() StoreDataArray {
	return storeDataArrayPool.Get().(StoreDataArray)
}
func (sda StoreDataArray) Copy() StoreDataArray {
	sda2 := NewStoreDataArray()
	sda2 = append(sda2, sda...)
	return sda2
}
func (sda *StoreDataArray) Push(sd StoreData) {
	*sda = append(*sda, sd)
	if len(*sda) > StoreDataMax {
		(*sda)[0] = StoreData{}
		*sda = (*sda)[1:]
	}
}
func (sda StoreDataArray) Len() int {
	return len(sda)
}
func (sda *StoreDataArray) Close() error {
	*sda = (*sda)[:0]
	storeDataArrayPool.Put(*sda)
	return nil
}
