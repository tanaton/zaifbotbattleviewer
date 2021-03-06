import * as d3 from 'd3';
import Vue from 'vue';

// 浮動小数点である事を分かりやすくしたい
type Float = number;

const CurrencyPair = {
	btc_jpy: "btc_jpy",
	xem_jpy: "xem_jpy",
	mona_jpy: "mona_jpy",
	bch_jpy: "bch_jpy",
	eth_jpy: "eth_jpy"
} as const;
type CurrencyPair = typeof CurrencyPair[keyof typeof CurrencyPair];
function isCurrencyPair(a: string): a is CurrencyPair {
	for (const it of Object.values(CurrencyPair)) {
		if (a === it) {
			return true;
		}
	}
	return false;
}

const CurrencyFirst = {
	btc: "btc",
	xem: "xem",
	mona: "mona",
	bch: "bch",
	eth: "eth"
} as const;
type CurrencyFirst = typeof CurrencyFirst[keyof typeof CurrencyFirst];
function isCurrencyFirst(a: string): a is CurrencyFirst {
	for (const it of Object.values(CurrencyFirst)) {
		if (a === it) {
			return true;
		}
	}
	return false;
}

const CurrencySecond = {
	jpy: "jpy",
	btc: "btc"
} as const;
type CurrencySecond = typeof CurrencySecond[keyof typeof CurrencySecond];
function isCurrencySecond(a: string): a is CurrencySecond {
	for (const it of Object.values(CurrencySecond)) {
		if (a === it) {
			return true;
		}
	}
	return false;
}

const Direction = {
	down: "▼",
	up: "▲"
} as const;
type Direction = typeof Direction[keyof typeof Direction];
function isDirection(a: string): a is Direction {
	switch (a) {
		case Direction.down:	// fallthrough
		case Direction.up:		// fallthrough
			return true;
		default:
	}
	return false;
}
const DirectionEng = {
	ask: "ask",
	bid: "bid"
} as const;
type DirectionEng = typeof DirectionEng[keyof typeof DirectionEng];
function isDirectionEng(a: string): a is DirectionEng {
	switch (a) {
		case DirectionEng.ask:		// fallthrough
		case DirectionEng.bid:		// fallthrough
			return true;
		default:
	}
	return false;
}
const Signal = {
	Asks: "Asks",
	Bids: "Bids",
	LastPrice: "LastPrice"
} as const;
type Signal = typeof Signal[keyof typeof Signal];
function isSignal(a: string): a is Signal {
	switch (a) {
		case Signal.Asks:			// fallthrough
		case Signal.Bids:			// fallthrough
		case Signal.LastPrice:		// fallthrough
			return true;
		default:
	}
	return false;
}
const AskBid = {
	Asks: "Asks",
	Bids: "Bids"
} as const;
type AskBid = typeof AskBid[keyof typeof AskBid];

const ViewerActive = {
	active: "active",
	none: ""
} as const;
type ViewerActive = typeof ViewerActive[keyof typeof ViewerActive];

type Box = {
	top: number;
	right: number;
	bottom: number;
	left: number;
}

type TradeView = {
	tid: number;
	trade_type: DirectionEng;
	direction: Direction | "";
	price_orig: number;
	price: string;
	amount: number;
	date: string;
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

type ZaifBoard = [number, number];
type ZaifTrade = {
	tid: number;
	trade_type: DirectionEng;
	price: number;
	amount: number;
	date: number;
}
type ZaifLastPrice = {
	price: number;
	action: DirectionEng;
}
type ZaifStream = {
	currency_pair: CurrencyPair;
	timestamp: string;
	asks: ZaifBoard[];
	bids: ZaifBoard[];
	trades: ZaifTrade[];
	last_price: ZaifLastPrice;
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
	if ((a.asks as ZaifBoard[]).every(it => it.length === 2) === false) {
		return false;
	}
	if ((a.bids instanceof Array) === false) {
		return false;
	}
	if ((a.bids as ZaifBoard[]).every(it => it.length === 2) === false) {
		return false;
	}
	if ((a.trades instanceof Array) === false) {
		return false;
	}
	if ((a.trades as ZaifTrade[]).every(it => isDirectionEng(it.trade_type)) === false) {
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
		Data: number;
	};
};
type Stream = {
	Name: CurrencyPair | "";
	Date: number;
	Signals: StreamSignals;
	Depths?: {
		Asks?: [number, number][],
		Bids?: [number, number][]
	};
}

type ChartPathData = {
	date: number;
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
		first: CurrencyFirst;
		second: CurrencySecond;
	};
	date_diff: number;
	readonly currencys: {
		readonly [key in CurrencyPair]: {
			readonly name: string;
			readonly hash: string;
			active: ViewerActive;
		};
	};
}

const svgID = "svgarea" as const;
const streamBaseURL = "wss://ws.zaif.jp/stream?currency_pair=" as const;
const historyDataURL = "/api/zaif/1/oldstream/" as const;
const currency_pair_list = [
	CurrencyPair.btc_jpy,
	CurrencyPair.xem_jpy,
	CurrencyPair.mona_jpy,
	CurrencyPair.bch_jpy,
	CurrencyPair.eth_jpy
] as const;
const currency_hash_default = "#" + CurrencyPair.btc_jpy;
const currency_url_base = "/zaif/#";
const timeFormat = d3.timeFormat("%H:%M:%S");
const floatFormat = d3.format(".1f");
const atoi = (str: string): number => parseInt(str, 10);
const PriceMax = 10_000_000;
const PriceMin = -10_000_000;
const summaryUpdateInterval = 30 * 1000;	// 30秒
const focusUpdateIntervalFPS = 10;
const focusXAxisSec = 120;
class ZaifDate {
	private diff: number;
	private diffmax: number;
	private tmpdate: Date;

	constructor() {
		this.diff = 0;
		this.diffmax = 0;
		this.tmpdate = new Date();
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
			if (d.length >= 7) {
				this.tmpdate.setFullYear(d[0], d[1] - 1, d[2]);
				this.tmpdate.setHours(d[3], d[4], d[5], (d[6] / 1000) | 0);
				zaif = this.tmpdate.getTime();
			} else {
				zaif = Date.now();
			}
		}
		const diff = zaif - Date.now();
		if (this.diffmax === 0 || diff < this.diffmax) {
			this.diffmax = diff;
		}
		this.diff = diff;
	}
	public reset(): void {
		this.diff = 0;
		this.diffmax = 0;
	}
	public getDate(): Date {
		return new Date(Date.now() + this.diffmax);
	}
	public getTime(): number {
		this.tmpdate.setTime(Date.now() + this.diffmax);
		return this.tmpdate.getTime();
	}
	public getDiff(): number {
		return this.diff;
	}
}
const fixDate = new ZaifDate();

class Graph {
	private focus_margin: Box = { top: 10, right: 10, bottom: 20, left: 55 };
	private focus_width: number = 0;
	private focus_height: number = 0;
	private summary_margin: Box = { top: 10, right: 10, bottom: 20, left: 55 };
	private summary_width: number = 0;
	private summary_height: number = 0;
	private depth_margin: Box = { top: 10, right: 10, bottom: 20, left: 55 };
	private depth_width: number = 0;
	private depth_height: number = 0;
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
	private focus_xAxis_g: d3.Selection<SVGGElement, unknown, HTMLElement, unknown>;
	private focus_yAxis_g: d3.Selection<SVGGElement, unknown, HTMLElement, unknown>;
	private focus_line: d3.Line<ChartPathData>;
	private focus_path_d: (d: Context) => string | null;
	private focus_legend_update: (d: Legend) => string;
	private focus_path_g: d3.Selection<SVGPathElement, Context, SVGSVGElement, unknown>;
	private focus_legend_g: d3.Selection<HTMLSpanElement, Legend, HTMLElement, unknown>;

	private summary_x: d3.ScaleTime<number, number>;
	private summary_y: d3.ScaleLinear<number, number>;
	private summary_xAxis: d3.Axis<Date>;
	private summary_yAxis: d3.Axis<number | { valueOf(): number; }>;
	private summary_xAxis_g: d3.Selection<SVGGElement, unknown, HTMLElement, unknown>;
	private summary_yAxis_g: d3.Selection<SVGGElement, unknown, HTMLElement, unknown>;
	private summary_line: d3.Line<ChartPathData>;
	private summary_path_d: (d: Context) => string | null;
	private summary_path_g: d3.Selection<SVGPathElement, Context, SVGSVGElement, unknown>;

	private depth_x: d3.ScaleLinear<number, number>;
	private depth_y: d3.ScaleLinear<number, number>;
	private depth_xAxis: d3.Axis<number | { valueOf(): number; }>;
	private depth_yAxis: d3.Axis<number>;
	private depth_xAxis_g: d3.Selection<SVGGElement, unknown, HTMLElement, unknown>;
	private depth_yAxis_g: d3.Selection<SVGGElement, unknown, HTMLElement, unknown>;
	private depth_line: d3.Line<ChartDepthData>;
	private depth_path_d: (d: Depth) => string | null;
	private depth_line_area: d3.Area<ChartDepthData>;
	private depth_area_d: (d: Depth) => string | null;
	private depth_path_g: d3.Selection<SVGPathElement, Depth, SVGSVGElement, unknown>;
	private depth_area_g: d3.Selection<SVGPathElement, Depth, SVGSVGElement, unknown>;

	private summary_color: d3.ScaleOrdinal<string, string>;
	private summary_path_stroke: (d: { name: string }) => string;

	private focus_data: Context[] = [];
	private focus_data_legend: Legend[] = [];
	private summary_data: Context[] = [];
	private context_data: Context[] = [];
	private depth_data: [Depth, Depth] = [{
		name: AskBid.Asks,
		values: []
	}, {
		name: AskBid.Bids,
		values: []
	}];
	private ydtmp: readonly [ChartPathData, ChartPathData];
	private datamap: { [key in Signal]?: boolean } = {};

	private draw_focus: boolean = false;
	private draw_summary: boolean = false;
	private draw_summary_old_date: number = fixDate.getTime();
	private draw_depth: boolean = false;
	private focus_domain_yaxis_update: boolean = false;
	private focus_xaxis_sec: number = 120;

	constructor(obj: Stream) {
		this.ydtmp = [{
			date: obj.Date,
			data: PriceMax
		}, {
			date: obj.Date,
			data: PriceMin
		}];

		this.focus_x = d3.scaleTime()
			.domain([0, 0]);
		this.focus_y = d3.scaleLinear()
			.domain([PriceMax, PriceMin]);
		this.focus_xAxis = d3.axisBottom<Date>(this.focus_x)
			.tickFormat(timeFormat)
			.tickPadding(7)
			.ticks(5);
		this.focus_yAxis = d3.axisLeft(this.focus_y)
			.tickPadding(7)
			.ticks(5);
		this.focus_line = d3.line<ChartPathData>()
			//.curve(d3.curveLinear)
			.curve(d3.curveStepAfter)
			.x(d => this.focus_x(d.date))
			.y(d => this.focus_y(d.data));
		this.focus_path_d = d => this.focus_line(d.values);

		this.summary_x = d3.scaleTime()
			.domain(this.focus_x.domain());
		this.summary_y = d3.scaleLinear()
			.domain(this.focus_y.domain());
		this.summary_xAxis = d3.axisBottom<Date>(this.summary_x)
			.tickFormat(timeFormat)
			.tickPadding(7)
			.ticks(5);
		this.summary_yAxis = d3.axisLeft(this.summary_y)
			.tickPadding(7);
		this.summary_line = d3.line<ChartPathData>()
			//.curve(d3.curveLinear)
			.curve(d3.curveStepAfter)
			.x(d => this.summary_x(d.date))
			.y(d => this.summary_y(d.data));
		this.summary_path_d = d => this.summary_line(d.values);

		this.depth_x = d3.scaleLinear()
			.domain([0, 0]);
		this.depth_y = d3.scaleLinear()
			.domain([PriceMax, PriceMin]);
		this.depth_xAxis = d3.axisBottom(this.depth_x)
			.tickPadding(7)
			.ticks(5);
		this.depth_yAxis = d3.axisLeft<number>(this.depth_y)
			.tickFormat((depth: number) => (depth >= 1000000) ? floatFormat(depth / 1000000) + "M" : ((depth / 1000) | 0) + "k")
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

		this.focus_legend_update = (d: Legend): string => `${d.name} ${d.last_price.toLocaleString(undefined, { maximumFractionDigits: 5 })}`;

		// オブジェクト構築
		this.init(obj);

		this.dom = d3.select("#" + svgID).append("div").attr("class", "row");
		this.svg = d3.select("#" + svgID).append("svg");

		this.focus = this.svg.selectAll<SVGGElement, Context>(".focus")
			.data(this.focus_data)
			.enter().append("g")
			.attr("class", "focus");

		this.focus_legend = this.dom.selectAll<HTMLDivElement, Legend>(".focus-legend")
			.data(this.focus_data_legend)
			.enter().append("div")
			.attr("class", "col-12 col-sm-6 col-md-4 col-xl-3 focus-legend");

		this.summary = this.svg.selectAll<SVGGElement, Context>(".summary")
			.data(this.summary_data)
			.enter().append("g")
			.attr("class", "summary");

		this.depth = this.svg.selectAll<SVGGElement, Depth>(".depth")
			.data(this.depth_data)
			.enter().append("g")
			.attr("class", "depth");

		this.focus_path_g = this.focus.append("path")	// 拡大グラフ
			.attr("class", "line focus-path")
			.style("stroke", this.summary_path_stroke);

		this.focus_xAxis_g = this.svg.append("g") 		// x目盛軸
			.attr("class", "x axis focus-x");

		this.focus_yAxis_g = this.svg.append("g")		// y目盛軸
			.attr("class", "y axis focus-y");

		this.focus_legend.append('span')	        	// 凡例の色付け四角
			.html("&#x25A0;")                           // Black Square
			.style("color", this.summary_path_stroke)
			.attr("class", "focus-legend-rect");

		this.focus_legend_g = this.focus_legend.append('span')  // 凡例の文言
			.text(this.focus_legend_update)
			.attr("class", "focus-legend-text");

		this.summary_path_g = this.summary.append("path")       // 全体グラフ
			.attr("class", "line summary-path")
			.style("stroke", this.summary_path_stroke);

		this.summary_xAxis_g = this.svg.append("g")		// 全体x目盛軸
			.attr("class", "x axis summary-x");

		this.summary_yAxis_g = this.svg.append("g")		// 全体y目盛軸
			.attr("class", "y axis summary-y");

		this.depth_path_g = this.depth.append("path")   // 深さグラフ
			.attr("class", "line depth-path")
			.style("stroke", this.summary_path_stroke);

		this.depth_area_g = this.depth.append("path")      // 深さグラフ領域
			.attr("class", "depth-area-path")
			.attr("opacity", .3)
			.style("fill", this.summary_path_stroke);

		this.depth_xAxis_g = this.svg.append("g") 		// 深さx目盛軸
			.attr("class", "x axis depth-x");

		this.depth_yAxis_g = this.svg.append("g")		// 深さy目盛軸
			.attr("class", "y axis depth-y");

		// 大きさや位置を整える
		this.resize();
	}
	private init(data: Stream): void {
		this.summary_color.domain([]);
		this.addsig(data);
		this.startTimer(focusUpdateIntervalFPS);
	}
	private startTimer(fps: number): void {
		if (fps <= 0) {
			return
		}
		const data: Stream = {
			Name: "",
			Date: 0,
			Signals: {
				Asks: { Data: 0 },
				Bids: { Data: 0 },
				LastPrice: { Data: 0 }
			}
		};
		this.tid = window.setInterval((): void => {
			let flag = false;
			data.Date = fixDate.getTime();
			for (const it of this.context_data) {
				const val = it.values;
				if (val.length > 0) {
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
		if (this.tid !== 0) {
			window.clearInterval(this.tid);
			this.tid = 0;
		}
	}
	public restartTimer(fps: number): void {
		this.stopTimer();
		this.startTimer(fps);
	}
	public resize(): void {
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

		this.focus_x.range([0, this.focus_width]);
		this.focus_y.range([this.focus_height, 0]);
		this.focus_xAxis.tickSizeInner(-this.focus_height);
		this.focus_yAxis.tickSizeInner(-this.focus_width);

		this.summary_x.range([0, this.summary_width]);
		this.summary_y.range([this.summary_height, 0]);
		this.summary_xAxis.tickSizeInner(-this.summary_height);
		this.summary_yAxis.tickSizeInner(-this.summary_width);

		this.depth_x.range([0, this.depth_width]);
		this.depth_y.range([this.depth_height, 0]);
		this.depth_xAxis
			.tickSizeOuter(-this.depth_height)
			.tickSizeInner(-this.depth_height);
		this.depth_yAxis
			.tickSizeOuter(-this.depth_width)
			.tickSizeInner(-this.depth_width);

		this.svg
			.attr("width", this.focus_width + this.focus_margin.left + this.focus_margin.right + 10)
			.attr("height", this.depth_height + this.depth_margin.top + this.depth_margin.bottom + 10);

		this.focus.attr("transform", `translate(${this.focus_margin.left},${this.focus_margin.top})`);
		this.summary.attr("transform", `translate(${this.summary_margin.left},${this.summary_margin.top})`);
		this.depth.attr("transform", `translate(${this.depth_margin.left},${this.depth_margin.top})`);

		this.focus_xAxis_g
			.attr("transform", `translate(${this.focus_margin.left},${this.focus_height + this.focus_margin.top})`);
		this.focus_yAxis_g
			.attr("transform", `translate(${this.focus_margin.left},${this.focus_margin.top})`);
		this.summary_xAxis_g
			.attr("transform", `translate(${this.summary_margin.left},${this.summary_height + this.summary_margin.top})`);
		this.summary_yAxis_g
			.attr("transform", `translate(${this.summary_margin.left},${this.summary_margin.top})`);
		this.depth_xAxis_g
			.attr("transform", `translate(${this.depth_margin.left},${this.depth_height + this.depth_margin.top})`);
		this.depth_yAxis_g
			.attr("transform", `translate(${this.depth_margin.left},${this.depth_margin.top})`);
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
	private static appendData(data: Context, val: ChartPathData, realtime: boolean = false) {
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
	public addContext(data: Stream, lastflag: boolean = false): void {
		const date = data.Date;
		const datestart = date - (this.focus_xaxis_sec * 1000);
		const l = this.focus_data.length;
		const sigs = data.Signals;
		if (!sigs) {
			return;
		}
		// 一定時間経過でsummary更新
		if ((date - summaryUpdateInterval) > this.draw_summary_old_date) {
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
			const fdv = fd.values;
			const cdv = cd.values;
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
			while (fdv.length > 1000) {
				fdv.shift();
			}
			while ((fdv.length > 2) && (fdv[0].date < datestart) && (fdv[1].date < datestart)) {
				fdv.shift();
			}
			if (fdv[0].date < datestart) {
				fdv[0].date = datestart;
			}
			while (cdv.length > 16000) {
				cdv.shift();
			}
			if (this.draw_summary || lastflag) {
				// contextを要約してsummaryを作る
				Graph.LTTB(sd.values, cdv, 200);
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
		if (!it) {
			return;
		}
		const values = data.values;
		let dep = 0;
		let index = 0;
		if (values[index] === undefined) {
			values[index] = { price: it[0][0], depth: 0 };
		} else {
			values[index].price = it[0][0];
			values[index].depth = 0;
		}
		++index;
		for (const val of it) {
			dep += val[0] * val[1];
			if (values[index] === undefined) {
				values[index] = { price: val[0], depth: dep };
			} else {
				values[index].price = val[0];
				values[index].depth = dep;
			}
			++index;
		}
		this.draw_depth = true;
	}
	public static contextMinFunc(num: number, it: ChartPathData): number {
		return Math.min(num, it.data);
	}
	public static contextMaxFunc(num: number, it: ChartPathData): number {
		return Math.max(num, it.data);
	}
	public updateFocusDomain(all = false): void {
		const date = fixDate.getTime();
		const datestart = date - (this.focus_xaxis_sec * 1000);
		const focus_xd = [datestart, date];
		const ydtmp = this.ydtmp;

		// 縦軸の値の幅を設定
		if (this.focus_domain_yaxis_update === false && all === false) {
			for (const fd of this.focus_data) {
				const fdv = fd.values;
				const l = fdv.length - 1;
				if (l >= 0) {
					const data = fdv[l].data;
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
				return Math.min(num, data);
			}, PriceMax);
		}
		if (ydtmp[1].date < datestart || this.focus_domain_yaxis_update || all) {
			ydtmp[1].data = this.focus_data.reduce((num, it) => {
				const data = it.values.reduce(Graph.contextMaxFunc, PriceMin);
				return Math.max(num, data);
			}, PriceMin);
		}
		this.focus_domain_yaxis_update = false;
		this.focus_x.domain(focus_xd);
		this.focus_y.domain([ydtmp[0].data, ydtmp[1].data]).nice();
	}
	public updateSummaryDomain(): void {
		const date = fixDate.getTime();
		const summary_xd = [date, date];
		const summary_yd = this.summary_y.domain();

		for (const cd of this.summary_data) {
			const cdv = cd.values;
			summary_yd[0] = cdv.reduce(Graph.contextMinFunc, PriceMax);
			summary_yd[1] = cdv.reduce(Graph.contextMaxFunc, PriceMin);
			if (summary_xd[0] > cdv[0].date) {
				summary_xd[0] = cdv[0].date;
			}
		}
		this.summary_x.domain(summary_xd);
		this.summary_y.domain(summary_yd).nice();
	}
	public static depthMaxFunc(num: number, it: ChartDepthData): number {
		return Math.max(num, it.depth);
	}
	public updateDepthDomain(): void {
		const depth_xd = this.depth_x.domain();
		const depth_yd = this.depth_y.domain();
		const dd = this.depth_data;
		depth_xd[0] = dd[1].values.reduce((num, it) => Math.min(num, it.price), PriceMax);
		depth_xd[1] = dd[0].values.reduce((num, it) => Math.max(num, it.price), PriceMin);
		depth_yd[0] = 0;
		depth_yd[1] = Math.max(
			dd[0].values.reduce(Graph.depthMaxFunc, PriceMin),
			dd[1].values.reduce(Graph.depthMaxFunc, PriceMin)
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
		return a.date - b.date;
	}
	public setFocusXAxis(sec: number = 120): void {
		const datestart = fixDate.getTime() - (sec * 1000);
		const l = this.focus_data.length;
		const f = (it: ChartPathData): boolean => it.date >= datestart;
		for (let i = 0; i < l; i++) {
			const cv = this.context_data[i].values;
			const j = cv.findIndex(f);
			if (j >= 1) {
				this.focus_data[i].values = cv.slice(j - 1);
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
			this.focus_path_g.attr("d", this.focus_path_d);	     // 拡大グラフアップデート
			this.focus_legend_g.text(this.focus_legend_update);  // 拡大グラフ凡例アップデート
			this.focus_xAxis_g.call(this.focus_xAxis);	         // 拡大x軸アップデート
			this.focus_yAxis_g.call(this.focus_yAxis); 	    	 // 拡大y軸アップデート
		}
		if (this.draw_summary) {
			this.draw_summary = false;
			this.updateSummaryDomain();
			this.summary_path_g.attr("d", this.summary_path_d);	      // 全体グラフアップデート
			this.summary_xAxis_g.call(this.summary_xAxis);            // 全体x軸アップデート
			this.summary_yAxis.tickValues(this.summary_y.domain());
			this.summary_yAxis_g.call(this.summary_yAxis);            // 全体x軸アップデート
		}
		if (this.draw_depth) {
			this.draw_depth = false;
			this.updateDepthDomain();
			this.depth_path_g.attr("d", this.depth_path_d);		// 深さグラフアップデート
			this.depth_area_g.attr("d", this.depth_area_d);     // 深さグラフ領域アップデート
			this.depth_xAxis_g.call(this.depth_xAxis);          // 深さx軸アップデート
			this.depth_yAxis_g.call(this.depth_yAxis);          // 深さy軸アップデート
		}
	}

	// Largest Triangle Three Bucketsアルゴリズム
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
				avgX += src[avgRangeStart].date;
				avgY += src[avgRangeStart].data;
			}
			avgX /= avgRangeLength;
			avgY /= avgRangeLength;
			// Point a
			const pointAX = src[a].date;
			const pointAY = src[a].data;
			let maxArea: Float = PriceMin;
			for (; bucketStart < bucketCenter; bucketStart++) {
				const d = src[bucketStart];
				// Calculate triangle area over three buckets
				const area = abs(((pointAX - avgX) * (d.data - pointAY)) - ((pointAX - d.date) * (avgY - pointAY)));
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
	private ws?: WebSocket;
	private currency_pair: CurrencyPair = Client.getCurrencyPair(currency_hash_default);
	private resize_timeid: number = 0;
	private tmpdate: Date;

	constructor(hash: string = currency_hash_default) {
		this.tmpdate = new Date();
		this.init(hash);
		window.addEventListener("resize", () => this.changesize(), false);
		window.addEventListener("orientationchange", () => this.changesize(), false);
		window.addEventListener("hashchange", () => {
			dispdata.focus.xaxis.selected = focusXAxisSec;
			dispdata.focus.fps.selected = focusUpdateIntervalFPS;
			this.clear();
			this.init(location.hash);
		}, false);
	}
	public init(hash: string = currency_hash_default): void {
		fixDate.reset();    // 時間補正を初期化
		this.currency_pair = Client.getCurrencyPair(hash);
		this.loadHistory();
		this.ws = new WebSocket(this.getWebsocketURL());
		this.ws.addEventListener('open', () => { console.log('接続しました。'); });
		this.ws.addEventListener('error', error => { console.error(`WebSocket Error ${error}`); });
		this.ws.addEventListener('close', () => { console.log('切断しました。'); });
		this.ws.addEventListener('message', msg => {
			const obj = JSON.parse(msg.data);
			if (isZaifStream(obj)) {
				this.update(obj);
			}
		});
	}
	public clear(): void {
		if (this.resize_timeid > 0) {
			window.clearTimeout(this.resize_timeid);
			this.resize_timeid = 0;
		}
		this.ws?.close();
		this.ws = undefined;
		this.graph?.dispose();
		this.graph = undefined;
	}
	public resize(): void {
		this.graph?.resize();
		this.graph?.draw(true);
	}
	public changesize(): void {
		if (this.resize_timeid > 0) {
			window.clearTimeout(this.resize_timeid);
			this.resize_timeid = 0;
		}
		this.resize_timeid = window.setTimeout(() => {
			this.resize();
			this.resize_timeid = 0;
		}, 128);
	}
	private static getCurrencyPair(hash: string = currency_hash_default): CurrencyPair {
		const cp = hash.slice(1);
		return currency_pair_list.find(data => data === cp) ?? currency_pair_list[0];
	}
	private getWebsocketURL(): string {
		return streamBaseURL + this.currency_pair;
	}
	private static getDirection(action: DirectionEng): Direction {
		return action === DirectionEng.ask ? Direction.down : Direction.up;
	}
	private update(obj: ZaifStream) {
		// 時刻調整
		fixDate.set(obj.timestamp);
		const data: Stream = {
			Name: obj.currency_pair,
			Date: fixDate.getTime(),
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
				dispdata.currencys[key].active = ViewerActive.none;
			}
		}
		dispdata.currencys[this.currency_pair].active = ViewerActive.active;
		{
			const [first, second] = this.currency_pair.split("_");
			dispdata.currency_pair.first = (isCurrencyFirst(first)) ? first : CurrencyFirst.btc;
			dispdata.currency_pair.second = (isCurrencySecond(second) ? second : CurrencySecond.jpy);
		}
		dispdata.last_trade.price = obj.last_price.price.toLocaleString(undefined, { maximumFractionDigits: 5 });
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
			this.tmpdate.setTime(it.date * 1000);
			if (dispdata.trades[i] === undefined) {
				dispdata.trades[i] = {
					tid: it.tid,
					trade_type: it.trade_type,
					direction: dir,
					price_orig: it.price,
					price: it.price.toLocaleString(undefined, { maximumFractionDigits: 5 }),
					amount: it.amount,
					date: timeFormat(this.tmpdate)
				};
			} else {
				dispdata.trades[i].tid = it.tid;
				dispdata.trades[i].trade_type = it.trade_type;
				dispdata.trades[i].direction = dir;
				dispdata.trades[i].price_orig = it.price;
				dispdata.trades[i].price = it.price.toLocaleString(undefined, { maximumFractionDigits: 5 });
				dispdata.trades[i].amount = it.amount;
				dispdata.trades[i].date = timeFormat(this.tmpdate);
			}
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
			const price = it[0].toLocaleString(undefined, { maximumFractionDigits: 5 });
			const depth = (dep | 0).toLocaleString(undefined, { maximumFractionDigits: 5 });
			if (dst[index] === undefined) {
				dst[index] = {
					price: price,
					amount: it[1],
					depth: depth
				};
			} else {
				dst[index].price = price;
				dst[index].amount = it[1];
				dst[index].depth = depth;
			}
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
			this.graph.addContext(obj);
			this.graph.addDepth(obj);
		}
	}
	private loadHistory(): void {
		const url = historyDataURL + this.currency_pair;
		const controller = new AbortController();
		Promise.race<Promise<Response>>([
			fetch(url, { signal: controller.signal }),
			new Promise((_, reject): void => {
				setTimeout(() => {
					controller.abort();
					reject(new Error("timeout"));
				}, 10000);
			})
		]).then((resp: Response) => {
			if (resp.ok) {
				return resp.json();
			}
			throw new Error(resp.statusText);
		}).then(value => {
			console.log("履歴の取得に成功");
			this.addDataHistory(value);
		}).catch(err => {
			console.error(err);
		});
	}
	private addDataHistory(data: readonly History[]): void {
		let ask: readonly [number, number] | undefined = undefined;
		let bid: readonly [number, number] | undefined = undefined;
		let trade: HistoryTrade | undefined = undefined;
		const len = data.length - 1;
		const obj: Stream = {
			Name: this.currency_pair,
			Date: 0,
			Signals: {
				Asks: {
					Data: 0
				},
				Bids: {
					Data: 0
				},
				LastPrice: {
					Data: 0
				}
			}
		};
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
				obj.Date = it.ts * 1000;
				obj.Signals.Asks.Data = ask[0];
				obj.Signals.Bids.Data = bid[0];
				obj.Signals.LastPrice.Data = trade.price;
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
			this.graph.updateSummaryDomain();
			this.graph.draw(true);
		}
	}
}

const dispdata: Display = {
	last_trade: {
		price: "0",
		action: Direction.up,
		type: DirectionEng.bid
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
		first: CurrencyFirst.btc,
		second: CurrencySecond.jpy
	},
	date_diff: 0,
	currencys: {
		btc_jpy: { name: CurrencyFirst.btc + "/" + CurrencySecond.jpy, hash: currency_url_base + CurrencyPair.btc_jpy, active: ViewerActive.none },
		xem_jpy: { name: CurrencyFirst.xem + "/" + CurrencySecond.jpy, hash: currency_url_base + CurrencyPair.xem_jpy, active: ViewerActive.none },
		mona_jpy: { name: CurrencyFirst.mona + "/" + CurrencySecond.jpy, hash: currency_url_base + CurrencyPair.mona_jpy, active: ViewerActive.none },
		bch_jpy: { name: CurrencyFirst.bch + "/" + CurrencySecond.jpy, hash: currency_url_base + CurrencyPair.bch_jpy, active: ViewerActive.none },
		eth_jpy: { name: CurrencyFirst.eth + "/" + CurrencySecond.jpy, hash: currency_url_base + CurrencyPair.eth_jpy, active: ViewerActive.none }
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
