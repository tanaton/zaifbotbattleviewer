import * as d3 from 'd3';
import Vue from 'vue';

// 浮動小数点である事を分かりやすくしたい
type Float = number;

type CurrencyPair = "btc_jpy" | "xem_jpy" | "mona_jpy" | "bch_jpy" | "eth_jpy";
function isCurrencyPair(a: string): a is CurrencyPair {
    switch (a) {
        case "btc_jpy":		// fallthrough
        case "xem_jpy":		// fallthrough
        case "mona_jpy":	// fallthrough
        case "bch_jpy":		// fallthrough
        case "eth_jpy":		// fallthrough
            return true;
        default:
    }
    return false;
}
type Direction = "▼" | "▲";
function isDirection(a: string): a is Direction {
    switch (a) {
        case "▼":		// fallthrough
        case "▲":		// fallthrough
            return true;
        default:
    }
    return false;
}
type DirectionEng = "ask" | "bid";
function isDirectionEng(a: string): a is DirectionEng {
    switch (a) {
        case "ask":		// fallthrough
        case "bid":		// fallthrough
            return true;
        default:
    }
    return false;
}
type Signal = "Asks" | "Bids" | "LastPrice";
function isSignal(a: string): a is Signal {
    switch (a) {
        case "Asks":			// fallthrough
        case "Bids":			// fallthrough
        case "LastPrice":		// fallthrough
            return true;
        default:
    }
    return false;
}
type AskBid = "Asks" | "Bids";

type Box = {
    top: number;
    right: number;
    bottom: number;
    left: number;
}

type TradeView = {
    readonly tid: number;
    readonly trade_type: DirectionEng;
    readonly direction: Direction | "";
    readonly price_orig: number;
    readonly price: string;
    readonly amount: number;
    readonly date: string;
}

type Board = {
    price: string;
    amount: number;
    depth: string;
}

type HistoryTrade = {
    readonly price: number;
    readonly amount: number;
    readonly trade_type: string;
}

type History = {
    readonly ts: number;
    readonly ask?: [number, number];
    readonly bid?: [number, number];
    readonly trade?: HistoryTrade;
}

type ZaifStream = {
    readonly currency_pair: CurrencyPair;
    readonly timestamp: string;
    asks: readonly [number, number][];
    bids: readonly [number, number][];
    trades: readonly {
        readonly tid: number;
        readonly trade_type: DirectionEng;
        readonly price: number;
        readonly amount: number;
        readonly date: number;
    }[];
    readonly last_price: {
        readonly price: number;
        readonly action: DirectionEng;
    };
}
function isZaifStream(a: any): a is ZaifStream {
    if ((a instanceof Object) === false) {
        return false;
    }
    if (isCurrencyPair(a.currency_pair) === false) {
        return false;
    }
    if (!a.timestamp) {
        return false;
    }
    if ((a.asks instanceof Array) === false) {
        return false;
    }
    if ((a.asks as [number, number][]).every(it => it.length === 2) === false) {
        return false;
    }
    if ((a.bids instanceof Array) === false) {
        return false;
    }
    if ((a.bids as [number, number][]).every(it => it.length === 2) === false) {
        return false;
    }
    if ((a.trades instanceof Array) === false) {
        return false;
    }
    if ((a.trades as readonly {
        readonly tid: number;
        readonly trade_type: DirectionEng;
        readonly price: number;
        readonly amount: number;
        readonly date: number;
    }[]).every(it => isDirectionEng(it.trade_type)) === false) {
        return false;
    }
    if ((a.last_price instanceof Object) === false) {
        return false;
    }
    if (isDirectionEng(a.last_price.action) === false) {
        return false;
    }
    return true;
}

type StreamSignals = {
    [key in Signal]: {
        readonly Data: number;
    };
};
type Stream = {
    readonly Name: CurrencyPair | "";
    readonly Date: Date;
    readonly Signals?: StreamSignals;
    readonly Depths?: {
        Asks?: readonly [number, number][],
        Bids?: readonly [number, number][]
    };
}

type ChartPathData = {
    date: Date;
    data: number;
}

type ChartDepthData = {
    price: number;
    depth: number;
}

type Context = {
    readonly name: Signal;
    values: ChartPathData[];
}

type Depth = {
    readonly name: AskBid;
    values: ChartDepthData[];
}

type Legend = {
    readonly name: Signal;
    last_price: number;
}

type Display = {
    readonly last_trade: {
        price: string;
        action: Direction;
        type: DirectionEng;
    };
    bids: Board[];
    asks: Board[];
    trades: TradeView[];
    readonly focus: {
        readonly xaxis: {
            selected: number;
            options: readonly {
                readonly text: string;
                readonly value: number;
            }[];
        };
        readonly fps: {
            selected: number;
            options: readonly {
                readonly text: string;
                readonly value: number;
            }[];
        };
    };
    readonly currency_pair: {
        first: string;
        second: string;
    };
    date_diff: number;
    readonly currencys: {
        readonly [key in CurrencyPair]: {
            readonly name: string;
            readonly hash: string;
            active: "active" | "";
        };
    };
}

const svgID = "svgarea";
const streamBaseURL = "wss://ws.zaif.jp/stream?currency_pair=";
const historyDataURL = "/api/zaif/1/oldstream/";
const currency_pair_list: readonly CurrencyPair[] = ["btc_jpy", "xem_jpy", "mona_jpy", "bch_jpy", "eth_jpy"];
const timeFormat = d3.timeFormat("%H:%M:%S");
const floatFormat = d3.format(".1f");
const atoi = (str: string): number => parseInt(str, 10);
const PriceMax = 10_000_000;
const PriceMin = -10_000_000;
const summaryUpdateInterval = 60 * 1000;	// 60秒
const focusUpdateIntervalFPS = 10;
const focusXAxisSec = 120;
class ZaifDate {
    private diff: number;
    constructor() {
        this.diff = 0;
    }
    public set(timestamp: string): void {
        let zaif = Date.parse(timestamp);
        if (Number.isNaN(zaif)) {
            // 2020-05-05 21:02:51.353793
            const d = timestamp.split(" ", 2)
                .map<string[]>((it, i) => {
                    if (i === 0) {
                        return it.split("-", 3);
                    }
                    const index = it.indexOf(".") ?? -1;
                    if (index < 0) {
                        return it.split(":", 3).concat(["0"]);
                    }
                    return it.slice(0, index).split(":", 3).concat([it.slice(index + 1)]);
                })
                .reduce((a, c) => a.concat(c))
                .map(atoi);
            zaif = d.length >= 7 ? (new Date(d[0], d[1] - 1, d[2], d[3], d[4], d[5], (d[6] / 1000) | 0)).getTime() : Date.now();
        }
        this.diff = zaif - Date.now();
    }
    public getDate(): Date {
        return new Date(Date.now() + this.diff);
    }
    public getDiff(): number {
        return this.diff;
    }
}
const fixDate = new ZaifDate();

class Graph {
    private focus_margin: Box = { top: 10, right: 10, bottom: 20, left: 55 };
    private focus_width: number;
    private focus_height: number;
    private summary_margin: Box = { top: 10, right: 10, bottom: 20, left: 55 };
    private summary_width: number;
    private summary_height: number;
    private depth_margin: Box = { top: 10, right: 10, bottom: 20, left: 55 };
    private depth_width: number;
    private depth_height: number;
    private tid: number = 0;
    private rid: number = 0;

    private dom: d3.Selection<HTMLDivElement, unknown, HTMLElement, unknown>;
    private svg: d3.Selection<SVGSVGElement, unknown, HTMLElement, unknown>;
    private focus: d3.Selection<SVGGElement, Context, SVGSVGElement, unknown>;
    private focus_legend: d3.Selection<HTMLDivElement, Legend, HTMLDivElement, unknown>;
    private summary: d3.Selection<SVGGElement, Context, SVGSVGElement, unknown>;
    private depth: d3.Selection<SVGGElement, Depth, SVGSVGElement, unknown>;

    private focus_x: d3.ScaleTime<number, number>;
    private focus_y: d3.ScaleLinear<number, number>;
    private focus_xAxis: d3.Axis<Date>;
    private focus_yAxis: d3.Axis<number | { valueOf(): number; }>;
    private focus_line: d3.Line<ChartPathData>;
    private focus_path_d: (d: Context) => string | null;

    private summary_x: d3.ScaleTime<number, number>;
    private summary_y: d3.ScaleLinear<number, number>;
    private summary_xAxis: d3.Axis<Date>;
    private summary_yAxis: d3.Axis<number | { valueOf(): number; }>;
    private summary_line: d3.Line<ChartPathData>;
    private summary_path_d: (d: Context) => string | null;

    private depth_x: d3.ScaleLinear<number, number>;
    private depth_y: d3.ScaleLinear<number, number>;
    private depth_xAxis: d3.Axis<number | { valueOf(): number; }>;
    private depth_yAxis: d3.Axis<number>;
    private depth_line: d3.Line<ChartDepthData>;
    private depth_path_d: (d: Depth) => string | null;
    private depth_line_area: d3.Area<ChartDepthData>;
    private depth_area_d: (d: Depth) => string | null;

    private summary_color: d3.ScaleOrdinal<string, string>;
    private summary_path_stroke: (d: { name: string }) => string;
    private focus_legend_update: (d: Legend) => string;

    private focus_data: Context[] = [];
    private focus_data_legend: Legend[] = [];
    private summary_data: Context[] = [];
    private context_data: Context[] = [];
    private depth_data: [Depth, Depth] = [{
        name: "Asks",
        values: []
    }, {
        name: "Bids",
        values: []
    }];
    private ydtmp: readonly [ChartPathData, ChartPathData];
    private datamap: { [key in Signal]?: boolean } = {};

    private draw_focus: boolean = false;
    private draw_summary: boolean = false;
    private draw_summary_old_date: Date = fixDate.getDate();
    private draw_depth: boolean = false;
    private focus_domain_yaxis_update: boolean = false;
    private focus_xaxis_sec: number = 120;

    constructor(obj: Stream) {
        const div = document.getElementById(svgID);
        const width = div?.offsetWidth ?? 850;
        this.focus_width = width - this.focus_margin.left - this.focus_margin.right;
        this.focus_height = Math.min(this.focus_width, 500);
        this.summary_margin.top = this.focus_height + this.focus_margin.top + this.focus_margin.bottom + 10;
        this.summary_width = width - this.summary_margin.left - this.summary_margin.right;
        this.summary_height = 100;
        this.depth_margin.top = this.summary_height + this.summary_margin.top + this.summary_margin.bottom + 10;
        this.depth_width = width - this.depth_margin.left - this.depth_margin.right;
        this.depth_height = 130;
        this.ydtmp = [{
            date: obj.Date,
            data: PriceMax
        }, {
            date: obj.Date,
            data: PriceMin
        }];

        this.focus_x = d3.scaleTime()
            .domain([0, 0])
            .range([0, this.focus_width]);
        this.focus_y = d3.scaleLinear()
            .domain([PriceMax, PriceMin])
            .range([this.focus_height, 0]);
        this.focus_xAxis = d3.axisBottom<Date>(this.focus_x)
            .tickSizeInner(-this.focus_height)
            .tickFormat(timeFormat)
            .tickPadding(7)
            .ticks(5);
        this.focus_yAxis = d3.axisLeft(this.focus_y)
            .tickSizeInner(-this.focus_width)
            .tickPadding(7)
            .ticks(5);
        this.focus_line = d3.line<ChartPathData>()
            //.curve(d3.curveLinear)
            .curve(d3.curveStepAfter)
            .x(d => this.focus_x(d.date))
            .y(d => this.focus_y(d.data));
        this.focus_path_d = d => this.focus_line(d.values);

        this.summary_x = d3.scaleTime()
            .domain(this.focus_x.domain())
            .range([0, this.summary_width]);
        this.summary_y = d3.scaleLinear()
            .domain(this.focus_y.domain())
            .range([this.summary_height, 0]);
        this.summary_xAxis = d3.axisBottom<Date>(this.summary_x)
            .tickSizeInner(-this.summary_height)
            .tickFormat(timeFormat)
            .tickPadding(7)
            .ticks(5);
        this.summary_yAxis = d3.axisLeft(this.summary_y)
            .tickSizeInner(-this.summary_width)
            .tickPadding(7);
        this.summary_line = d3.line<ChartPathData>()
            //.curve(d3.curveLinear)
            .curve(d3.curveStepAfter)
            .x(d => this.summary_x(d.date))
            .y(d => this.summary_y(d.data));
        this.summary_path_d = d => this.summary_line(d.values);

        this.depth_x = d3.scaleLinear()
            .domain([0, 0])
            .range([0, this.depth_width]);
        this.depth_y = d3.scaleLinear()
            .domain([PriceMax, PriceMin])
            .range([this.depth_height, 0]);
        this.depth_xAxis = d3.axisBottom(this.depth_x)
            .tickSizeOuter(-this.depth_height)
            .tickSizeInner(-this.depth_height)
            .tickPadding(7)
            .ticks(5);
        this.depth_yAxis = d3.axisLeft<number>(this.depth_y)
            .tickSizeOuter(-this.depth_width)
            .tickSizeInner(-this.depth_width)
            .tickFormat((depth: number) => {
                let ret;
                if (depth >= 1000000) {
                    ret = floatFormat(depth / 1000000) + "M";
                } else {
                    ret = ((depth / 1000) | 0) + "k";
                }
                return ret;
            })
            .tickPadding(7)
            .ticks(2);
        this.depth_line = d3.line<ChartDepthData>()
            .curve(d3.curveStepAfter)
            .x(d => this.depth_x(d.price))
            .y(d => this.depth_y(d.depth));
        this.depth_path_d = d => this.depth_line(d.values);
        this.depth_line_area = d3.area<ChartDepthData>()
            .curve(d3.curveStepAfter)
            .x(d => this.depth_x(d.price))
            .y0(() => this.depth_y(0))
            .y1(d => this.depth_y(d.depth));
        this.depth_area_d = d => this.depth_line_area(d.values);

        this.summary_color = d3.scaleOrdinal<string>().range(["#b94047", "#47ba41", "#4147ba", "#bab441", "#41bab4", "#b441ba"]);
        this.summary_path_stroke = d => this.summary_color(d.name);

        this.focus_legend_update = (d: Legend): string => `${d.name} ${d.last_price.toLocaleString()}`;

        // オブジェクト構築
        this.init(obj);

        this.dom = d3.select("#" + svgID).append("div").attr("class", "row");
        this.svg = d3.select("#" + svgID).append("svg");
        this.svg
            .attr("width", this.focus_width + this.focus_margin.left + this.focus_margin.right + 10)
            .attr("height", this.depth_height + this.depth_margin.top + this.depth_margin.bottom + 10);

        this.focus = this.svg.selectAll<SVGGElement, Context>(".focus")
            .data(this.focus_data)
            .enter().append("g")
            .attr("transform", `translate(${this.focus_margin.left},${this.focus_margin.top})`)
            .attr("class", "focus");

        this.focus_legend = this.dom.selectAll<HTMLDivElement, Legend>(".focus-legend")
            .data(this.focus_data_legend)
            .enter().append("div")
            .attr("class", "col-6 col-sm-4 col-xl-3 focus-legend");

        this.summary = this.svg.selectAll<SVGGElement, Context>(".summary")
            .data(this.summary_data)
            .enter().append("g")
            .attr("transform", `translate(${this.summary_margin.left},${this.summary_margin.top})`)
            .attr("class", "summary");

        this.depth = this.svg.selectAll<SVGGElement, Depth>(".depth")
            .data(this.depth_data)
            .enter().append("g")
            .attr("transform", `translate(${this.depth_margin.left},${this.depth_margin.top})`)
            .attr("class", "depth");

        this.focus.append("path")				// 拡大グラフ
            .attr("class", "line focus-path")
            .style("stroke", this.summary_path_stroke);

        this.svg.append("g") 					// x目盛軸
            .attr("class", "x axis focus-x")
            .attr("transform", `translate(${this.focus_margin.left},${this.focus_height + this.focus_margin.top})`)
            .call(this.focus_xAxis);

        this.svg.append("g")					// y目盛軸
            .attr("class", "y axis focus-y")
            .attr("transform", `translate(${this.focus_margin.left},${this.focus_margin.top})`)
            .call(this.focus_yAxis);

        this.focus_legend.append('span')		// 凡例の色付け四角
            .html("&#x25A0;")                   // Black Square
            .style("color", this.summary_path_stroke)
            .attr("class", "focus-legend-rect");

        this.focus_legend.append('span')		// 凡例の文言
            .text(this.focus_legend_update)
            .attr("class", "focus-legend-text");

        this.summary.append("path")				// 全体グラフ
            .attr("class", "line summary-path")
            .style("stroke", this.summary_path_stroke);

        this.svg.append("g")				// 全体x目盛軸
            .attr("class", "x axis summary-x")
            .attr("transform", `translate(${this.summary_margin.left},${this.summary_height + this.summary_margin.top})`)
            .call(this.summary_xAxis);

        this.svg.append("g")				// 全体y目盛軸
            .attr("class", "y axis summary-y")
            .attr("transform", `translate(${this.summary_margin.left},${this.summary_margin.top})`)
            .call(this.summary_yAxis);

        this.depth.append("path")				// 深さグラフ
            .attr("class", "line depth-path")
            .style("stroke", this.summary_path_stroke);

        this.depth.append("path")			// 深さグラフ領域
            .attr("class", "depth-area-path")
            .attr("opacity", .3)
            .style("fill", this.summary_path_stroke);

        this.svg.append("g") 					// 深さx目盛軸
            .attr("class", "x axis depth-x")
            .attr("transform", `translate(${this.depth_margin.left},${this.depth_height + this.depth_margin.top})`)
            .call(this.depth_xAxis);

        this.svg.append("g")					// 深さy目盛軸
            .attr("class", "y axis depth-y")
            .attr("transform", `translate(${this.depth_margin.left},${this.depth_margin.top})`)
            .call(this.depth_yAxis);
    }
    private init(data: Stream): void {
        this.summary_color.domain([]);
        this.addsig(data);
        //this.addContext(data);
        //this.addDepth(data);
        this.startTimer(focusUpdateIntervalFPS);
    }
    private startTimer(fps: number): void {
        if (fps <= 0) {
            return
        }
        this.tid = window.setInterval((): void => {
            const data: Stream = {
                Name: "",
                Date: fixDate.getDate(),
                Signals: {
                    "Asks": { Data: 0 },
                    "Bids": { Data: 0 },
                    "LastPrice": { Data: 0 }
                }
            };
            let flag = false;
            for (const it of this.context_data) {
                const val = it.values;
                if (val.length > 0 && data.Signals !== undefined) {
                    data.Signals[it.name] = {
                        Data: val[val.length - 1].data
                    };
                    flag = true;
                }
            }
            if (flag) {
                this.addContext(data);
            }
            this.draw();
        }, 1000 / fps);
    }
    private stopTimer(): void {
        if (this.tid) {
            window.clearInterval(this.tid);
            this.tid = 0;
        }
    }
    public restartTimer(fps: number): void {
        this.stopTimer();
        this.startTimer(fps);
    }
    public dispose(): void {
        this.stopTimer();
        if (this.rid) {
            window.cancelAnimationFrame(this.rid);
            this.rid = 0;
        }
        const doc = document.getElementById(svgID);
        if (doc) {
            doc.innerHTML = "";
        }
    }
    private addsig(data: Stream): boolean {
        const date = data.Date;
        const sigs = data.Signals;
        const summary_color: string[] = [];
        let ret = false;
        for (const key in sigs) {
            if (isSignal(key) && sigs.hasOwnProperty(key) && this.datamap[key] === undefined) {
                const data = sigs[key].Data ?? 0;
                const cpd: ChartPathData = { date: date, data: data };
                summary_color.push(key);
                this.context_data.push({ name: key, values: [cpd] });
                this.focus_data.push({ name: key, values: [cpd] });
                this.summary_data.push({ name: key, values: [cpd] });
                this.focus_data_legend.push({ name: key, last_price: 0 });
                this.datamap[key] = true;
                ret = true;
            }
        }
        this.summary_color.domain(summary_color);
        return ret;
    }
    // copy on write的な戦略でメモリ管理する
    private static appendData(data: Context, val: ChartPathData, realtime?: boolean) {
        const dv = data.values;
        const old: ChartPathData | undefined = dv[dv.length - 1];
        // 点の数を減らす処理
        if (old !== undefined) {
            if (realtime) {
                // リアルタイム性が欲しい場合
                const oldold: ChartPathData | undefined = dv[dv.length - 2];
                if ((oldold?.data === old.data) && (old.data === val.data)) {
                    // 2つ前と1つ前と今回のデータが同じ場合
                    // 1つ前のデータを今回の時間に更新
                    dv[dv.length - 1] = val;
                } else {
                    dv.push(val);
                }
            } else if (old.data !== val.data) {
                // 違うデータの場合のみ更新
                dv.push(val);
            }
        } else {
            dv.push(val);
        }
    }
    public addContext(data: Stream, lastflag?: boolean): void {
        const date = data.Date;
        const datestart = new Date(date.getTime() - (this.focus_xaxis_sec * 1000));
        const l = this.focus_data.length;
        const sigs = data.Signals;
        if (!sigs) {
            return;
        }
        // 一定時間経過でsummary更新
        if ((date.getTime() - summaryUpdateInterval) > this.draw_summary_old_date.getTime()) {
            this.draw_summary = true;
        }
        for (let i = 0; i < l; i++) {
            const fd = this.focus_data[i];
            const sd = this.summary_data[i];
            const cd = this.context_data[i];
            const key = fd.name;
            if (!sigs[key]) {
                continue;
            }
            const d = sigs[key].Data;
            const cpd: ChartPathData = {
                date: date,
                data: d
            };
            Graph.appendData(fd, cpd, true);
            this.draw_focus = true;

            Graph.appendData(cd, cpd);
            this.focus_data_legend[i].last_price = d;
            // データサイズが大きくなり過ぎないように調節
            // shift使っているから重い説
            while (fd.values.length > 1000) {
                fd.values.shift();
            }
            while ((fd.values.length > 2) && (fd.values[0].date < datestart) && (fd.values[1].date < datestart)) {
                fd.values.shift();
            }
            while (cd.values.length > 16000) {
                cd.values.shift();
            }
            if (this.draw_summary || lastflag) {
                // contextを要約してsummaryを作る
                Graph.LTTB(sd.values, cd.values, 200);
                this.draw_summary_old_date = date;
            }
        }
    }
    public addDepth(data: Stream): void {
        const deps = data.Depths ?? {};
        this.addDepthSub(deps.Asks, this.depth_data[0]);
        this.addDepthSub(deps.Bids, this.depth_data[1]);
    }
    private addDepthSub(it: readonly [number, number][] | undefined, data: Depth): void {
        if (it) {
            const values = data.values;
            let dep = 0;
            let index = 0;
            if (values[index] === undefined) {
                values[index] = { price: 0, depth: 0 };
            }
            values[index].price = it[0][0];
            values[index].depth = 0;
            ++index;
            for (const val of it) {
                dep += val[0] * val[1];
                if (values[index] === undefined) {
                    values[index] = { price: 0, depth: 0 };
                }
                values[index].price = val[0];
                values[index].depth = dep;
                ++index;
            }
            this.draw_depth = true;
        }
    }
    public static contextMinFunc(num: number, it: ChartPathData): number {
        return (num < it.data) ? num : it.data;
    }
    public static contextMaxFunc(num: number, it: ChartPathData): number {
        return (num > it.data) ? num : it.data;
    }
    public updateFocusDomain(all = false): void {
        const date = fixDate.getDate();
        const datestart = new Date(date.getTime() - (this.focus_xaxis_sec * 1000));
        const focus_xd = [datestart, date];
        const ydtmp = this.ydtmp;

        // 縦軸の値の幅を設定
        if (this.focus_domain_yaxis_update === false && all === false) {
            for (const fd of this.focus_data) {
                const l = fd.values.length - 1;
                if (l >= 0) {
                    const data = fd.values[l].data;
                    if (ydtmp[0].data > data) {
                        ydtmp[0].date = date;
                        ydtmp[0].data = data;
                    } else if (ydtmp[1].data < data) {
                        ydtmp[1].date = date;
                        ydtmp[1].data = data;
                    }
                }
            }
        }
        // 現在の最大最小が表示外になった場合
        if (ydtmp[0].date < datestart || this.focus_domain_yaxis_update || all) {
            ydtmp[0].data = this.focus_data.reduce((num, it) => {
                const data = it.values.reduce(Graph.contextMinFunc, PriceMax);
                return (num < data) ? num : data;
            }, PriceMax);
        }
        if (ydtmp[1].date < datestart || this.focus_domain_yaxis_update || all) {
            ydtmp[1].data = this.focus_data.reduce((num, it) => {
                const data = it.values.reduce(Graph.contextMaxFunc, PriceMin);
                return (num > data) ? num : data;
            }, PriceMin);
        }
        this.focus_domain_yaxis_update = false;
        this.focus_x.domain(focus_xd);
        this.focus_y.domain([ydtmp[0].data, ydtmp[1].data]).nice();
    }
    public updateSummaryDomain(all = false): void {
        const date = fixDate.getDate();
        const summary_xd = this.summary_x.domain();
        const summary_yd = this.summary_y.domain();
        summary_xd[0] = date;
        summary_xd[1] = date;

        if (all) {
            for (const cd of this.summary_data) {
                summary_yd[0] = cd.values.reduce(Graph.contextMinFunc, summary_yd[0]);
                summary_yd[1] = cd.values.reduce(Graph.contextMaxFunc, summary_yd[1]);
                if (summary_xd[0] > cd.values[0].date) {
                    summary_xd[0] = cd.values[0].date;
                }
            }
        } else {
            for (const cd of this.summary_data) {
                const l = cd.values.length - 1;
                if (l >= 0) {
                    const data = cd.values[l].data;
                    // 最大値の更新
                    if (summary_yd[0] > data) {
                        summary_yd[0] = data;
                    }
                    if (summary_yd[1] < data) {
                        summary_yd[1] = data;
                    }
                    if (summary_xd[0] > cd.values[0].date) {
                        summary_xd[0] = cd.values[0].date;
                    }
                }
            }
        }
        this.summary_x.domain(summary_xd);
        this.summary_y.domain(summary_yd).nice();
    }
    public static depthMaxFunc(num: number, it: ChartDepthData): number {
        return (num > it.depth) ? num : it.depth;
    }
    public updateDepthDomain(): void {
        const depth_xd = this.depth_x.domain();
        const depth_yd = this.depth_y.domain();
        depth_xd[0] = this.depth_data[1].values.reduce((num, it) => (num < it.price) ? num : it.price, PriceMax);
        depth_xd[1] = this.depth_data[0].values.reduce((num, it) => (num > it.price) ? num : it.price, PriceMin);
        depth_yd[0] = 0;
        depth_yd[1] = Math.max(
            this.depth_data[0].values.reduce(Graph.depthMaxFunc, PriceMin),
            this.depth_data[1].values.reduce(Graph.depthMaxFunc, PriceMin)
        );
        this.depth_x.domain(depth_xd);
        this.depth_y.domain(depth_yd).nice();
    }
    public sortContext(): void {
        const l = this.focus_data.length;
        for (let i = 0; i < l; i++) {
            this.focus_data[i].values.sort(Graph.compChartPathData);
            this.context_data[i].values.sort(Graph.compChartPathData);
            this.summary_data[i].values.sort(Graph.compChartPathData);
        }
    }
    public static compChartPathData(a: ChartPathData, b: ChartPathData): number {
        return a.date.getTime() - b.date.getTime();
    }
    public setFocusXAxis(sec: number = 120): void {
        const datestart = new Date(fixDate.getDate().getTime() - (sec * 1000));
        const l = this.focus_data.length;
        for (let i = 0; i < l; i++) {
            const cv = this.context_data[i].values;
            const j = cv.findIndex(it => it.date >= datestart);
            if (j >= 0) {
                this.focus_data[i].values = cv.slice(j);
            }
        }
        this.focus_domain_yaxis_update = true;
        this.focus_xaxis_sec = sec;
    }
    public draw(all = false): void {
        if (all) {
            this.draw_focus = true;
            this.draw_summary = true;
            this.draw_depth = true;
        }
        if (this.rid === 0) {
            this.rid = window.requestAnimationFrame((): void => {
                this.drawsub();
                this.rid = 0;
            });
        }
    }
    private drawsub(): void {
        if (this.draw_focus) {
            this.draw_focus = false;
            this.updateFocusDomain();
            this.focus.select<SVGPathElement>("path").attr("d", this.focus_path_d);	            	// 拡大グラフアップデート
            this.focus_legend.select<HTMLDivElement>(".focus-legend-text").text(this.focus_legend_update);
            this.svg.select<SVGGElement>(".x.axis.focus-x").call(this.focus_xAxis);	        		// 拡大x軸アップデート
            this.svg.select<SVGGElement>(".y.axis.focus-y").call(this.focus_yAxis); 	    		// 拡大y軸アップデート
        }
        if (this.draw_summary) {
            this.draw_summary = false;
            this.updateSummaryDomain();
            this.summary.select<SVGPathElement>("path").attr("d", this.summary_path_d);	            // 全体グラフアップデート
            this.svg.select<SVGGElement>(".x.axis.summary-x").call(this.summary_xAxis);		        // 全体x軸アップデート
            this.summary_yAxis.tickValues(this.summary_y.domain());
            this.svg.select<SVGGElement>(".y.axis.summary-y").call(this.summary_yAxis);	        	// 全体x軸アップデート
        }
        if (this.draw_depth) {
            this.draw_depth = false;
            this.updateDepthDomain();
            this.depth.select<SVGPathElement>("path.depth-path").attr("d", this.depth_path_d);		// 深さグラフアップデート
            this.depth.select<SVGPathElement>("path.depth-area-path").attr("d", this.depth_area_d); // 深さグラフ領域アップデート
            this.svg.select<SVGGElement>(".x.axis.depth-x").call(this.depth_xAxis);		        	// 深さx軸アップデート
            this.svg.select<SVGGElement>(".y.axis.depth-y").call(this.depth_yAxis); 	    		// 深さy軸アップデート
        }
    }

    // https://github.com/dgryski/go-lttb を参考に作成
    public static LTTB(dst: ChartPathData[], src: readonly ChartPathData[], threshold: number = 200): void {
        let index = 0;
        const srclen = src.length;
        if (threshold >= srclen || threshold < 3) {
            for (index = 0; index < srclen; ++index) {
                dst[index] = src[index];
            }
            if (dst.length > index) {
                dst.length = index;
            }
            return;
        }
        const abs = Math.abs;
        const floor = Math.floor;
        // 最初の点は残す
        dst[index++] = src[0];
        // Bucket size. Leave room for start and end data points
        const every: Float = (srclen - 2) / (threshold - 2);
        let bucketStart: number = 1;
        let bucketCenter: number = floor(every) + 1;
        let a: number = 0;
        for (let i: number = 0; i < threshold - 2; i++) {
            const bucketEnd: number = floor((i + 2) * every) + 1;

            // Calculate point average for next bucket (containing c)
            let avgRangeStart: number = bucketCenter
            let avgRangeEnd: number = bucketEnd

            if (avgRangeEnd >= srclen) {
                avgRangeEnd = srclen;
            }
            // float
            const avgRangeLength: Float = avgRangeEnd - avgRangeStart;
            let avgX: Float = 0;
            let avgY: Float = 0;
            for (; avgRangeStart < avgRangeEnd; avgRangeStart++) {
                avgX += src[avgRangeStart].date.getTime();
                avgY += src[avgRangeStart].data;
            }
            avgX /= avgRangeLength;
            avgY /= avgRangeLength;
            // Point a
            const pointAX = src[a].date.getTime();
            const pointAY = src[a].data;
            let maxArea: Float = PriceMin;
            for (; bucketStart < bucketCenter; bucketStart++) {
                const d = src[bucketStart];
                // Calculate triangle area over three buckets
                const area = abs(((pointAX - avgX) * (d.data - pointAY)) - ((pointAX - d.date.getTime()) * (avgY - pointAY)));
                if (area > maxArea) {
                    maxArea = area;
                    a = bucketStart;			// Next a is this b
                }
            }
            dst[index++] = src[a];				// Pick this point from the bucket
            bucketCenter = bucketEnd;
        }
        dst[index++] = src[srclen - 1];	// Always add last
        if (dst.length > index) {
            dst.length = index;
        }
    }
}

class Client {
    private graph?: Graph = undefined;
    private readonly ws: WebSocket;
    private readonly currency_pair: CurrencyPair;

    constructor(hash: string = "#btc_jpy") {
        this.currency_pair = Client.getCurrencyPair(hash);
        this.loadHistory();
        this.ws = new WebSocket(this.getWebsocketURL());
        this.ws.onopen = () => {
            console.log('接続しました。');
        };
        this.ws.onerror = (error) => {
            console.error(`WebSocket Error ${error}`);
        };
        this.ws.onclose = () => {
            console.log('切断しました。');
        };
        this.ws.onmessage = (msg) => {
            const obj = JSON.parse(msg.data);
            if (isZaifStream(obj)) {
                this.update(obj);
            }
        };
    }
    public dispose(): void {
        this.ws.close();
        this.graph?.dispose();
        this.graph = undefined;
    }
    private static getCurrencyPair(hash: string = "#btc_jpy"): CurrencyPair {
        const cp = hash.slice(1);
        return currency_pair_list.find(data => data === cp) ?? currency_pair_list[0];
    }
    private getWebsocketURL(): string {
        return streamBaseURL + this.currency_pair;
    }
    private static getDirection(action: DirectionEng): Direction {
        return action === "ask" ? "▼" : "▲";
    }
    private update(obj: ZaifStream) {
        // 時刻調整
        fixDate.set(obj.timestamp);
        const data: Stream = {
            Name: obj.currency_pair,
            Date: fixDate.getDate(),
            Signals: {
                Asks: {
                    Data: obj.asks[0][0]
                },
                Bids: {
                    Data: obj.bids[0][0]
                },
                LastPrice: {
                    Data: obj.last_price.price
                }
            },
            Depths: {
                Asks: obj.asks,
                Bids: obj.bids
            }
        };
        if (this.graph === undefined) {
            this.createGraph(data);
        }
        this.addData(data);
        // vue用
        this.updateView(obj);
    }
    private updateView(obj: ZaifStream): void {
        for (const key in dispdata.currencys) {
            if (isCurrencyPair(key) && dispdata.currencys.hasOwnProperty(key)) {
                dispdata.currencys[key].active = "";
            }
        }
        dispdata.currencys[this.currency_pair].active = "active";
        {
            const cp: readonly string[] = this.currency_pair.split("_");
            dispdata.currency_pair.first = cp[0];
            dispdata.currency_pair.second = cp[1];
        }
        dispdata.last_trade.price = obj.last_price.price.toLocaleString();
        dispdata.last_trade.action = Client.getDirection(obj.last_price.action);
        dispdata.last_trade.type = obj.last_price.action;
        document.title = dispdata.last_trade.action
            + ` ${dispdata.last_trade.price}`
            + ` (${dispdata.currency_pair.first}/${dispdata.currency_pair.second}) 取引の様子`
            + ` - zaifの取引情報を表示するやつ`;
        for (let i = obj.trades.length - 1; i >= 0; --i) {
            const it = obj.trades[i];
            let dir: Direction | "" = "";
            if (i === obj.trades.length - 1) {
                dir = Client.getDirection(it.trade_type);
            } else {
                const old = dispdata.trades[i + 1];
                if (old.trade_type === it.trade_type && old.price_orig !== it.price) {
                    dir = Client.getDirection(it.trade_type);
                } else if (old.trade_type !== it.trade_type) {
                    dir = Client.getDirection(it.trade_type);
                }
            }
            dispdata.trades[i] = {
                tid: it.tid,
                trade_type: it.trade_type,
                direction: dir,
                price_orig: it.price,
                price: it.price.toLocaleString(),
                amount: it.amount,
                date: timeFormat(new Date(it.date * 1000))
            };
        }
        this.analyzeBoard(dispdata.bids, obj.bids);
        this.analyzeBoard(dispdata.asks, obj.asks);
        dispdata.date_diff = fixDate.getDiff();
    }
    private analyzeBoard(dst: Board[], data: readonly [number, number][]) {
        let dep = 0;
        let index = 0;
        for (const it of data) {
            dep += it[0] * it[1];
            if (dst[index] === undefined) {
                dst[index] = { price: "", amount: 0, depth: "" };
            }
            dst[index].price = it[0].toLocaleString();
            dst[index].amount = it[1];
            dst[index].depth = (dep | 0).toLocaleString();
            ++index;
        }
    }
    public setGraphFocusXAxis(sec: number): void {
        this.graph?.setFocusXAxis(sec);
    }
    public setGraphFocusFPS(fps: number): void {
        this.graph?.restartTimer(fps);
    }
    private createGraph(obj: Stream): void {
        this.graph = new Graph(obj);
    }
    private addData(obj: Stream): void {
        if (this.graph !== undefined) {
            this.graph.addContext(obj, true);
            this.graph.addDepth(obj);
        }
    }
    private loadHistory(): void {
        const url = historyDataURL + this.currency_pair;
        const xhr = new XMLHttpRequest();
        xhr.ontimeout = (): void => {
            console.error(`The request for ${url} timed out.`);
        };
        xhr.onload = (e): void => {
            if (xhr.readyState === 4) {
                if (xhr.status === 200) {
                    console.log("履歴の取得に成功");
                    this.addDataHistory(JSON.parse(xhr.responseText));
                } else {
                    console.error(xhr.statusText);
                }
            }
        };
        xhr.onerror = (e): void => {
            console.error(xhr.statusText);
        };
        xhr.open("GET", url, true);
        xhr.timeout = 5000;		// 5秒
        xhr.send(null);
    }
    private addDataHistory(data: readonly History[]): void {
        let ask: readonly [number, number] | undefined = undefined;
        let bid: readonly [number, number] | undefined = undefined;
        let trade: HistoryTrade | undefined = undefined;
        const len = data.length - 1;
        for (let index = 0; index <= len; ++index) {    // -1したlengthを後で利用する
            const it = data[index];
            if (it.ask !== undefined) {
                ask = it.ask;
            }
            if (it.bid !== undefined) {
                bid = it.bid;
            }
            if (it.trade !== undefined) {
                trade = it.trade;
            }
            if (ask !== undefined && bid !== undefined && trade !== undefined) {
                const obj: Stream = {
                    Name: this.currency_pair,
                    Date: new Date(it.ts * 1000),
                    Signals: {
                        Asks: {
                            Data: ask[0]
                        },
                        Bids: {
                            Data: bid[0]
                        },
                        LastPrice: {
                            Data: trade.price
                        }
                    }
                };
                if (this.graph === undefined) {
                    this.createGraph(obj);
                }
                if (this.graph) {
                    this.graph.addContext(obj, (index === len));    // 末尾判定
                }
            }
        }
        if (ask !== undefined && bid !== undefined && trade !== undefined && this.graph) {
            this.graph.sortContext();
            this.graph.updateFocusDomain(true);
            this.graph.updateSummaryDomain(true);
            this.graph.draw(true);
        }
    }
}

const dispdata: Display = {
    last_trade: {
        price: "0",
        action: "▲",
        type: "bid"
    },
    bids: [],
    asks: [],
    trades: [],
    focus: {
        xaxis: {
            selected: focusXAxisSec,
            options: [
                { text: "1分", value: 60 },
                { text: "2分", value: 120 },
                { text: "5分", value: 300 },
                { text: "10分", value: 600 },
                { text: "30分", value: 1800 }
            ]
        },
        fps: {
            selected: focusUpdateIntervalFPS,
            options: [
                { text: "無し", value: 0 },
                { text: "1fps", value: 1 },
                { text: "5fps", value: 5 },
                { text: "10fps", value: 10 },
                { text: "30fps", value: 30 },
                { text: "60fps", value: 60 }
            ]
        }
    },
    currency_pair: {
        first: "btc",
        second: "jpy"
    },
    date_diff: 0,
    currencys: {
        btc_jpy: { name: "btc/jpy", hash: "/zaif/#btc_jpy", active: "" },
        xem_jpy: { name: "xem/jpy", hash: "/zaif/#xem_jpy", active: "" },
        mona_jpy: { name: "mona/jpy", hash: "/zaif/#mona_jpy", active: "" },
        bch_jpy: { name: "bch/jpy", hash: "/zaif/#bch_jpy", active: "" },
        eth_jpy: { name: "eth/jpy", hash: "/zaif/#eth_jpy", active: "" }
    }
};
const vm = new Vue({
    el: "#container",
    data: dispdata,
    computed: {
        date_diff_print: () => (dispdata.date_diff / 1000).toString()
    },
    watch: {
        "focus.xaxis.selected": (n) => {
            cli.setGraphFocusXAxis(n);
        },
        "focus.fps.selected": (n) => {
            cli.setGraphFocusFPS(n);
        }
    }
});
let cli = new Client(location.hash);
window.addEventListener("hashchange", () => {
    dispdata.focus.xaxis.selected = focusXAxisSec;
    dispdata.focus.fps.selected = focusUpdateIntervalFPS;
    cli?.dispose();
    cli = new Client(location.hash);
}, false);
