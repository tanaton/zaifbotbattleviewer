import * as d3 from 'd3';
import Vue from 'vue';

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

type Display = {
    readonly last_trade: {
        price: string;
        action: Direction;
        type: DirectionEng;
    };
    asset_now: string;
    asset_per: string;
    readonly currency_number: number;
    readonly purchase_price: number;
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
const timeFormat = d3.timeFormat("%H:%M:%S");
const floatFormat = d3.format(".1f");
const PriceMax = 10_000_000;
const PriceMin = -10_000_000;

type Box = {
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
    readonly left: number;
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

type ChartPathData = {
    date: Date;
    data: number;
}

type ChartDepthData = {
    readonly price: number;
    readonly depth: number;
}

type Context = {
    readonly name: "price" | "cap" | "volume";
    values: ChartPathData[];
}

type Depth = {
    readonly name: AskBid;
    values: ChartDepthData[];
}

type MarketItem = {
    readonly date: Date;
    readonly price: number;
    readonly cap: number;
    readonly volume: number;
}
type ZaifDepth = {
    readonly asks: readonly [number, number][];
    readonly bids: readonly [number, number][];
}

class MarketGraph {
    private readonly summary_margin: Box = { top: 510, right: 10, bottom: 20, left: 60 };
    private summary_width: number;
    private summary_height: number;

    private svg: d3.Selection<SVGSVGElement, unknown, HTMLElement, unknown>;
    private summary: d3.Selection<SVGGElement, Context, SVGSVGElement, unknown>;

    private summary_x: d3.ScaleTime<number, number>;
    private summary_y: d3.ScaleLinear<number, number>;
    private summary_xAxis: d3.Axis<Date>;
    private summary_yAxis: d3.Axis<number | { valueOf(): number; }>;
    private summary_line: d3.Line<ChartPathData>;
    private summary_path_d: (d: Context) => string | null;

    private summary_color: d3.ScaleOrdinal<string, string>;
    private summary_path_stroke: (d: { name: string }) => string;

    private summary_data: Context[] = [{
        name: "price",
        values: []
    }, {
        name: "cap",
        values: []
    }, {
        name: "volume",
        values: []
    }];

    constructor() {
        this.summary_width = 850 - this.summary_margin.left - this.summary_margin.right;
        this.summary_height = 620 - this.summary_margin.top - this.summary_margin.bottom;

        this.summary_x = d3.scaleTime()
            .domain([0, 0])
            .range([0, this.summary_width]);
        this.summary_y = d3.scaleLinear()
            .domain([PriceMax, PriceMin])
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
            .curve(d3.curveStepAfter)
            .x(d => this.summary_x(d.date))
            .y(d => this.summary_y(d.data));
        this.summary_path_d = d => this.summary_line(d.values);

        this.summary_color = d3.scaleOrdinal<string>().range(["#b94047", "#47ba41", "#4147ba", "#bab441", "#41bab4", "#b441ba"]);
        this.summary_path_stroke = d => this.summary_color(d.name);

        // オブジェクト構築
        this.summary_color.domain(["price", "cap", "volume"]);

        this.svg = d3.select("#" + svgID).append("svg");
        this.svg
            .attr("width", this.summary_width + this.summary_margin.left + this.summary_margin.right + 10)
            .attr("height", this.summary_height + this.summary_margin.top + this.summary_margin.bottom + 10);

        this.summary = this.svg.selectAll<SVGGElement, Context>(".summary")
            .data(this.summary_data)
            .enter().append("g")
            .attr("transform", `translate(${this.summary_margin.left},${this.summary_margin.top})`)
            .attr("class", "summary");

        this.summary.append("path")				// 全体グラフ
            .attr("class", "line")
            .style("stroke", this.summary_path_stroke);

        this.summary.append("g")				// 全体x目盛軸
            .attr("class", "x axis")
            .attr("transform", `translate(0,${this.summary_height})`)
            .call(this.summary_xAxis);

        this.summary.append("g")				// 全体y目盛軸
            .attr("class", "y axis")
            .call(this.summary_yAxis);
    }
    public dispose(): void {
        const doc = document.getElementById(svgID);
        if (doc) {
            doc.innerHTML = "";
        }
    }
    public addData(obj: readonly MarketItem[]): void {
        for (const it of obj) {
            this.summary_data[0].values.push({ date: it.date, data: it.price });
            this.summary_data[1].values.push({ date: it.date, data: it.cap });
            this.summary_data[2].values.push({ date: it.date, data: it.volume });
        }
    }
    public draw(): void {
        this.summary.select<SVGPathElement>("path").attr("d", this.summary_path_d);	// 全体グラフアップデート
        this.summary.select<SVGGElement>(".x.axis").call(this.summary_xAxis);		// 全体x軸アップデート
        this.summary_yAxis.tickValues(this.summary_y.domain());
        this.summary.select<SVGGElement>(".y.axis").call(this.summary_yAxis);		// 全体x軸アップデート
    }
}

class DepthGraph {
    private readonly depth_margin: Box = { top: 630, right: 10, bottom: 20, left: 60 };
    private depth_width: number;
    private depth_height: number;
    private rid: number = 0;

    private svg: d3.Selection<SVGSVGElement, unknown, HTMLElement, unknown>;
    private depth: d3.Selection<SVGGElement, Depth, SVGSVGElement, unknown>;
    private depth_area: d3.Selection<SVGGElement, Depth, SVGSVGElement, unknown>;

    private depth_x: d3.ScaleLinear<number, number>;
    private depth_y: d3.ScaleLinear<number, number>;
    private depth_xAxis: d3.Axis<number | { valueOf(): number; }>;
    private depth_yAxis: d3.Axis<number>;
    private depth_line: d3.Line<ChartDepthData>;
    private depth_path_d: (d: Depth) => string | null;
    private depth_line_area: d3.Area<ChartDepthData>;
    private depth_area_d: (d: Depth) => string | null;

    private depth_color: d3.ScaleOrdinal<string, string>;
    private depth_path_stroke: (d: { name: string }) => string;

    private depth_data: [Depth, Depth] = [{
        name: "Asks",
        values: []
    }, {
        name: "Bids",
        values: []
    }];

    constructor() {
        this.depth_width = 850 - this.depth_margin.left - this.depth_margin.right;
        this.depth_height = 760 - this.depth_margin.top - this.depth_margin.bottom;

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

        this.depth_color = d3.scaleOrdinal<string>().range(["#b94047", "#47ba41", "#4147ba", "#bab441", "#41bab4", "#b441ba"]);
        this.depth_path_stroke = d => this.depth_color(d.name);

        // オブジェクト構築
        this.depth_color.domain(["asks", "bids"]);

        this.svg = d3.select("#" + svgID).append("svg");
        this.svg
            .attr("width", this.depth_width + this.depth_margin.left + this.depth_margin.right + 10)
            .attr("height", this.depth_height + this.depth_margin.top + this.depth_margin.bottom + 10);

        this.depth = this.svg.selectAll<SVGGElement, Depth>(".depth")
            .data(this.depth_data)
            .enter().append("g")
            .attr("transform", `translate(${this.depth_margin.left},${this.depth_margin.top})`)
            .attr("class", "depth");

        this.depth_area = this.svg.selectAll<SVGGElement, Depth>(".depth_area")
            .data(this.depth_data)
            .enter().append("g")
            .attr("transform", `translate(${this.depth_margin.left},${this.depth_margin.top})`)
            .attr("class", "depth_area");

        this.depth.append("path")				// 深さグラフ
            .attr("class", "line")
            .style("stroke", this.depth_path_stroke);

        this.depth_area.append("path")			// 深さグラフ領域
            .attr("class", "depth_area_path")
            .attr("opacity", .3)
            .style("fill", this.depth_path_stroke);

        this.depth.append("g") 					// 深さx目盛軸
            .attr("class", "x axis")
            .attr("transform", `translate(0,${this.depth_height})`)
            .call(this.depth_xAxis);

        this.depth.append("g")					// 深さy目盛軸
            .attr("class", "y axis")
            .call(this.depth_yAxis);
    }
    public dispose(): void {
        if (this.rid) {
            window.cancelAnimationFrame(this.rid);
            this.rid = 0;
        }
        const doc = document.getElementById(svgID);
        if (doc) {
            doc.innerHTML = "";
        }
    }
    public addData(data: ZaifDepth): void {
        [data.asks, data.bids].forEach((it, i) => {
            if (it) {
                let dep = 0;
                this.depth_data[i].values = it.map((price: readonly [number, number]): ChartDepthData => {
                    dep += price[0] * price[1];
                    return { price: price[0], depth: dep };
                });
                this.depth_data[i].values.unshift({ price: it[0][0], depth: 0 });
            }
        });
    }
    public static contextMinFunc(num: number, it: ChartPathData): number {
        return (num < it.data) ? num : it.data;
    }
    public static contextMaxFunc(num: number, it: ChartPathData): number {
        return (num > it.data) ? num : it.data;
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
            this.depth_data[0].values.reduce(DepthGraph.depthMaxFunc, PriceMin),
            this.depth_data[1].values.reduce(DepthGraph.depthMaxFunc, PriceMin)
        );
        this.depth_x.domain(depth_xd);
        this.depth_y.domain(depth_yd).nice();
    }
    public draw(): void {
        this.depth.select<SVGPathElement>("path").attr("d", this.depth_path_d);		// 深さグラフアップデート
        this.depth.select<SVGGElement>(".x.axis").call(this.depth_xAxis);			// 深さx軸アップデート
        this.depth.select<SVGGElement>(".y.axis").call(this.depth_yAxis); 			// 深さy軸アップデート
        this.depth_area.select<SVGPathElement>("path").attr("d", this.depth_area_d);// 深さグラフ領域アップデート
    }
}

class Client {
    private readonly ws: WebSocket;

    constructor() {
        this.ws = new WebSocket(streamBaseURL + "xem_jpy");
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
    }
    private static getDirection(action: DirectionEng): Direction {
        return action === "ask" ? "▼" : "▲";
    }
    private update(obj: ZaifStream) {
        dispdata.last_trade.price = obj.last_price.price.toLocaleString();
        dispdata.last_trade.action = Client.getDirection(obj.last_price.action);
        dispdata.last_trade.type = obj.last_price.action;
        const asset_now = obj.last_price.price * dispdata.currency_number;
        dispdata.asset_now = Math.round(asset_now).toLocaleString();
        const per = asset_now / (dispdata.currency_number * dispdata.purchase_price);
        if (per >= 1) {
            // 購入時の方が安い
            dispdata.asset_per = (Math.round(((per * 100) - 100) * 100) / 100).toLocaleString();
        } else {
            // 購入時の方が高い
            const per = (dispdata.currency_number * dispdata.purchase_price) / asset_now;
            dispdata.asset_per = (-1 * (Math.round(((per * 100) - 100) * 100) / 100)).toLocaleString();
        }
        document.title = dispdata.last_trade.action
            + ` ${dispdata.asset_now}`
            + ` (${dispdata.asset_per}%)`
            + ` （私の）暗号通貨資産の様子`;
    }
}

const dispdata: Display = {
    last_trade: {
        price: "0",
        action: "▲",
        type: "bid"
    },
    asset_now: "0",
    asset_per: "0",
    currency_number: 181886,
    purchase_price: 12.6452,
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
    data: dispdata
});
const cli = new Client();