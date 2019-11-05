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

const svgIDDepth = "svgdepth";
const svgIDCandlestick = "svgcandlestick";
const streamBaseURL = "wss://ws.zaif.jp/stream?currency_pair=";
const depthUrl = "/api/zaif/1/depth/xem_jpy";
const ticksUrl = "/api/zaif/1/ticks/xem_jpy";
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

type ZaifTick = {
    date: string;
    open: number;
    close: number;
    high: number;
    low: number;
    vwap: number;
    volume: number;
}

type Tick = {
    date: Date;
    open: number;
    close: number;
    high: number;
    low: number;
    vwap: number;
    volume: number;
}

type Ticks = {
    readonly name: string;
    values: Tick[];
}

type ChartDepthData = {
    readonly price: number;
    readonly depth: number;
}

type Depth = {
    readonly name: AskBid;
    values: ChartDepthData[];
}

type ZaifDepth = {
    readonly asks: readonly [number, number][];
    readonly bids: readonly [number, number][];
}

class CandlestickGraph {
    private readonly margin: Box = { top: 10, right: 10, bottom: 20, left: 60 };
    private width: number;
    private height: number;
    private rid: number = 0;

    private svg: d3.Selection<SVGSVGElement, unknown, HTMLElement, unknown>;
    private graph_rect: d3.Selection<SVGGElement, Ticks, SVGSVGElement, unknown>;
    private graph_highlow: d3.Selection<SVGGElement, Ticks, SVGSVGElement, unknown>;

    private x: d3.ScaleTime<number, number>;
    private y: d3.ScaleLinear<number, number>;
    private xAxis: d3.Axis<Date>;
    private yAxis: d3.Axis<number>;

    private color: d3.ScaleOrdinal<string, string>;
    private rect_stroke: (d: Ticks, i: number) => string;

    private data: Ticks[] = [];

    private candlewidth = 20;

    constructor() {
        this.width = 850 - this.margin.left - this.margin.right;
        this.height = 460 - this.margin.top - this.margin.bottom;

        this.x = d3.scaleTime()
            .domain([0, 0])
            .range([0, this.width]);
        this.y = d3.scaleLinear()
            .domain([PriceMax, PriceMin])
            .range([this.height, 0]);
        this.xAxis = d3.axisBottom<Date>(this.x)
            .tickSizeInner(-this.height)
            .tickFormat(timeFormat)
            .tickPadding(7)
            .ticks(5);
        this.yAxis = d3.axisLeft<number>(this.y)
            .tickSizeOuter(-this.width)
            .tickSizeInner(-this.width)
            .tickPadding(7)
            .ticks(2);

        this.color = d3.scaleOrdinal<string>().range(["#b94047", "#47ba41", "#4147ba", "#bab441", "#41bab4", "#b441ba"]);
        this.rect_stroke = (d, i) => (d.values[i].open > d.values[i].close) ? this.color("red") : this.color("green");

        // オブジェクト構築
        this.color.domain(["red", "green"]);

        this.svg = d3.select("#" + svgIDCandlestick).append("svg");
        this.svg
            .attr("width", this.width + this.margin.left + this.margin.right + 10)
            .attr("height", this.height + this.margin.top + this.margin.bottom + 10);

        this.graph_rect = this.svg.selectAll<SVGGElement, Ticks>(".ticks_rect")
            .data(this.data)
            .enter().append("g")
            .attr("transform", `translate(${this.margin.left},${this.margin.top})`)
            .attr("class", "ticks_rect");

        this.graph_highlow = this.svg.selectAll<SVGGElement, Ticks>(".ticks_highlow")
            .data(this.data)
            .enter().append("g")
            .attr("transform", `translate(${this.margin.left},${this.margin.top})`)
            .attr("class", "ticks_highlow");

        this.graph_rect.append("rect")			// ローソク本体グラフ領域
            .attr("class", "ticks_rect_path")
            .style("fill", this.rect_stroke)
            .attr("x", (d, i) => this.x(d.values[i].date))
            .attr("y", (d, i) => this.x(d.values[i].date))
            .attr("width", (d, i) => this.x(d.values[i].date))
            .attr("height", (d, i) => this.x(d.values[i].date));

        this.graph_highlow.append("path")		// highlowグラフ領域
            .attr("class", "ticks_highlow_path")
            .style("fill", this.rect_stroke);

        this.graph_rect.append("g") 			// 深さx目盛軸
            .attr("class", "x axis")
            .attr("transform", `translate(0,${this.height})`)
            .call(this.xAxis);

        this.graph_rect.append("g")				// 深さy目盛軸
            .attr("class", "y axis")
            .call(this.yAxis);
    }
    public dispose(): void {
        if (this.rid) {
            window.cancelAnimationFrame(this.rid);
            this.rid = 0;
        }
        const doc = document.getElementById(svgIDCandlestick);
        if (doc) {
            doc.innerHTML = "";
        }
    }
    public addData(data: ZaifTick[]): void {
        this.data.push({ name: "xem_jpy", values: [] });
        const val = this.data[0].values;
        for (const it of data) {
            if (it.date.length < 8) {
                continue;
            }
            val.push({
                date: new Date(+it.date.substr(0, 4), +it.date.substr(4, 6), +it.date.substr(6)),
                open: it.open,
                close: it.close,
                high: it.high,
                low: it.low,
                vwap: it.vwap,
                volume: it.volume,
            });
        }
    }
    public static lowMinFunc(num: number, it: Tick): number {
        return (num < it.low) ? num : it.low;
    }
    public static highMaxFunc(num: number, it: Tick): number {
        return (num > it.high) ? num : it.high;
    }
    public updateDepthDomain(): void {
        const xd = this.x.domain();
        const yd = this.y.domain();
        const data = this.data[0].values;
        const len = data.length;
        xd[0] = data[0].date;
        xd[1] = data[len - 1].date;
        yd[0] = data.reduce(CandlestickGraph.lowMinFunc, PriceMax);
        yd[1] = data.reduce(CandlestickGraph.highMaxFunc, PriceMin);
        this.x.domain(xd);
        this.y.domain(yd).nice();
    }
    public draw(): void {
        this.graph_rect.select<SVGGElement>(".x.axis").call(this.xAxis);		        // x軸アップデート
        this.graph_rect.select<SVGGElement>(".y.axis").call(this.yAxis); 			    // y軸アップデート
    }
}

class DepthGraph {
    private readonly margin: Box = { top: 10, right: 10, bottom: 20, left: 60 };
    private width: number;
    private height: number;
    private rid: number = 0;

    private svg: d3.Selection<SVGSVGElement, unknown, HTMLElement, unknown>;
    private graph: d3.Selection<SVGGElement, Depth, SVGSVGElement, unknown>;
    private graph_area: d3.Selection<SVGGElement, Depth, SVGSVGElement, unknown>;

    private x: d3.ScaleLinear<number, number>;
    private y: d3.ScaleLinear<number, number>;
    private xAxis: d3.Axis<number | { valueOf(): number; }>;
    private yAxis: d3.Axis<number>;
    private line: d3.Line<ChartDepthData>;
    private path_d: (d: Depth) => string | null;
    private line_area: d3.Area<ChartDepthData>;
    private area_d: (d: Depth) => string | null;

    private color: d3.ScaleOrdinal<string, string>;
    private path_stroke: (d: { name: string }) => string;

    private data: [Depth, Depth] = [{
        name: "Asks",
        values: []
    }, {
        name: "Bids",
        values: []
    }];

    constructor() {
        this.width = 850 - this.margin.left - this.margin.right;
        this.height = 260 - this.margin.top - this.margin.bottom;

        this.x = d3.scaleLinear()
            .domain([0, 0])
            .range([0, this.width]);
        this.y = d3.scaleLinear()
            .domain([PriceMax, PriceMin])
            .range([this.height, 0]);
        this.xAxis = d3.axisBottom(this.x)
            .tickSizeOuter(-this.height)
            .tickSizeInner(-this.height)
            .tickPadding(7)
            .ticks(5);
        this.yAxis = d3.axisLeft<number>(this.y)
            .tickSizeOuter(-this.width)
            .tickSizeInner(-this.width)
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
        this.line = d3.line<ChartDepthData>()
            .curve(d3.curveStepAfter)
            .x(d => this.x(d.price))
            .y(d => this.y(d.depth));
        this.path_d = d => this.line(d.values);
        this.line_area = d3.area<ChartDepthData>()
            .curve(d3.curveStepAfter)
            .x(d => this.x(d.price))
            .y0(() => this.y(0))
            .y1(d => this.y(d.depth));
        this.area_d = d => this.line_area(d.values);

        this.color = d3.scaleOrdinal<string>().range(["#b94047", "#47ba41", "#4147ba", "#bab441", "#41bab4", "#b441ba"]);
        this.path_stroke = d => this.color(d.name);

        // オブジェクト構築
        this.color.domain(["asks", "bids"]);

        this.svg = d3.select("#" + svgIDDepth).append("svg");
        this.svg
            .attr("width", this.width + this.margin.left + this.margin.right + 10)
            .attr("height", this.height + this.margin.top + this.margin.bottom + 10);

        this.graph = this.svg.selectAll<SVGGElement, Depth>(".depth")
            .data(this.data)
            .enter().append("g")
            .attr("transform", `translate(${this.margin.left},${this.margin.top})`)
            .attr("class", "depth");

        this.graph_area = this.svg.selectAll<SVGGElement, Depth>(".depth_area")
            .data(this.data)
            .enter().append("g")
            .attr("transform", `translate(${this.margin.left},${this.margin.top})`)
            .attr("class", "depth_area");

        this.graph.append("path")				// 深さグラフ
            .attr("class", "line")
            .style("stroke", this.path_stroke);

        this.graph_area.append("path")			// 深さグラフ領域
            .attr("class", "depth_area_path")
            .attr("opacity", .3)
            .style("fill", this.path_stroke);

        this.graph.append("g") 					// 深さx目盛軸
            .attr("class", "x axis")
            .attr("transform", `translate(0,${this.height})`)
            .call(this.xAxis);

        this.graph.append("g")					// 深さy目盛軸
            .attr("class", "y axis")
            .call(this.yAxis);
    }
    public dispose(): void {
        if (this.rid) {
            window.cancelAnimationFrame(this.rid);
            this.rid = 0;
        }
        const doc = document.getElementById(svgIDDepth);
        if (doc) {
            doc.innerHTML = "";
        }
    }
    public addData(data: ZaifDepth): void {
        [data.asks, data.bids].forEach((it, i) => {
            if (it) {
                let dep = 0;
                this.data[i].values = it.map((price: readonly [number, number]): ChartDepthData => {
                    dep += price[0] * price[1];
                    return { price: price[0], depth: dep };
                });
                this.data[i].values.unshift({ price: it[0][0], depth: 0 });
            }
        });
    }
    public static depthMaxFunc(num: number, it: ChartDepthData): number {
        return (num > it.depth) ? num : it.depth;
    }
    public updateDepthDomain(): void {
        const xd = this.x.domain();
        const yd = this.y.domain();
        xd[0] = this.data[1].values.reduce((num, it) => (num < it.price) ? num : it.price, PriceMax);
        xd[1] = this.data[0].values.reduce((num, it) => (num > it.price) ? num : it.price, PriceMin);
        yd[0] = 0;
        yd[1] = Math.max(
            this.data[0].values.reduce(DepthGraph.depthMaxFunc, PriceMin),
            this.data[1].values.reduce(DepthGraph.depthMaxFunc, PriceMin)
        );
        this.x.domain(xd);
        this.y.domain(yd).nice();
    }
    public draw(): void {
        this.graph.select<SVGPathElement>("path").attr("d", this.path_d);		// 深さグラフアップデート
        this.graph.select<SVGGElement>(".x.axis").call(this.xAxis);			// 深さx軸アップデート
        this.graph.select<SVGGElement>(".y.axis").call(this.yAxis); 			// 深さy軸アップデート
        this.graph_area.select<SVGPathElement>("path").attr("d", this.area_d);// 深さグラフ領域アップデート
    }
}

class Client {
    private readonly ws: WebSocket;
    private candlestick?: CandlestickGraph = undefined;
    private depth?: DepthGraph = undefined;
    private tid: number = 0;

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

        this.candlestick = new CandlestickGraph();
        Client.ajax(ticksUrl, (xhr: XMLHttpRequest): void => {
            if (this.candlestick) {
                this.candlestick.addData(JSON.parse(xhr.responseText));
                this.candlestick.updateDepthDomain();
                this.candlestick.draw();
            }
        });

        this.depth = new DepthGraph();
        const getDepthData = () => {
            // 1分に一回
            Client.ajax(depthUrl, (xhr: XMLHttpRequest): void => {
                if (this.depth) {
                    this.depth.addData(JSON.parse(xhr.responseText));
                    this.depth.updateDepthDomain();
                    this.depth.draw();
                }
            });
        };
        getDepthData();
        this.tid = window.setInterval(getDepthData, 60 * 1000);
    }
    public dispose(): void {
        if (this.ws) {
            this.ws.close();
        }
        if (this.tid) {
            window.clearInterval(this.tid);
        }
        if (this.depth) {
            this.depth.dispose();
        }
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
            + ` - 資産の様子`;
    }
    public static ajax(url: string, func: (xhr: XMLHttpRequest) => void, ) {
        const xhr = new XMLHttpRequest();
        xhr.ontimeout = (): void => {
            console.error(`The request for ${url} timed out.`);
        };
        xhr.onload = (e): void => {
            if (xhr.readyState === 4) {
                if (xhr.status === 200) {
                    func(xhr);
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