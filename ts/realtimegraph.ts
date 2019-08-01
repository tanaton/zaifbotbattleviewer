import * as d3 from 'd3';
import Vue from 'vue';

// 浮動小数点である事を分かりやすくしたい
type Float = number;

type CurrencyPair = "btc_jpy" | "xem_jpy" | "mona_jpy" | "bch_jpy" | "eth_jpy";
function isCurrencyPair(a: string): a is CurrencyPair {
	switch(a){
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
	switch(a){
		case "▼":		// fallthrough
		case "▲":		// fallthrough
			return true;
		default:
	}
	return false;
}
type DirectionEng = "ask" | "bid";
function isDirectionEng(a: string): a is DirectionEng {
	switch(a){
		case "ask":		// fallthrough
		case "bid":		// fallthrough
			return true;
		default:
	}
	return false;
}
type Signal = "Asks" | "Bids" | "LastPrice";
function isSignal(a: string): a is Signal {
	switch(a){
		case "Asks":			// fallthrough
		case "Bids":			// fallthrough
		case "LastPrice":		// fallthrough
			return true;
		default:
	}
	return false;
}
type AskBid = "Asks" | "Bids";

const svgID = "svgarea";
const streamBaseURL = "wss://ws.zaif.jp/stream?currency_pair=";
const historyDataURL = "/api/zaif/1/oldstream/";
const currency_pair_list: readonly CurrencyPair[] = ["btc_jpy", "xem_jpy", "mona_jpy", "bch_jpy", "eth_jpy"];
const timeFormat = d3.timeFormat("%H:%M:%S");
const floatFormat = d3.format(".1f");
const PriceMax = 10_000_000;
const PriceMin = -10_000_000;
const summaryUpdateInterval = 10 * 1000;	// 10秒
const focusUpdateIntervalFPS = 10;

type Box = {
	readonly top: number;
	readonly right: number;
	readonly bottom: number;
	readonly left: number;
}

type TradeView = {
	readonly trade_type: DirectionEng;
	readonly direction: Direction | "";
	readonly price_orig: number;
	readonly price: string;
	readonly amount: number;
	readonly date: string;
}

type Board = {
	readonly price: string;
	readonly amount: number;
	readonly depth: string;
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
	if((a instanceof Object) === false){
		return false;
	}
	if(isCurrencyPair(a.currency_pair) === false){
		return false;
	}
	if(!a.timestamp){
		return false;
	}
	if((a.asks instanceof Array) === false){
		return false;
	}
	if((a.asks as [number, number][]).every(it => it.length === 2) === false){
		return false;
	}
	if((a.bids instanceof Array) === false){
		return false;
	}
	if((a.bids as [number, number][]).every(it => it.length === 2) === false){
		return false;
	}
	if((a.trades instanceof Array) === false){
		return false;
	}
	if((a.trades as readonly {
		readonly trade_type: DirectionEng;
		readonly price: number;
		readonly amount: number;
		readonly date: number;
	}[]).every(it => isDirectionEng(it.trade_type)) === false){
		return false;
	}
	if((a.last_price instanceof Object) === false){
		return false;
	}
	if(isDirectionEng(a.last_price.action) === false){
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

type ChartContextData = {
	date: Date;
	data: number;
}

type ChartDepthData = {
	readonly price: number;
	readonly depth: number;
}

type Context = {
	readonly name: Signal;
	values: ChartContextData[];
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
	bids: readonly Board[];
	asks: readonly Board[];
	trades: readonly TradeView[];
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

class Graph {
	private readonly focus_margin: Box = {top: 30, right: 10, bottom: 20, left: 60};
	private focus_width: number;
	private focus_height: number;
	private readonly summary_margin: Box = {top: 510, right: 10, bottom: 20, left: 60};
	private summary_width: number;
	private summary_height: number;
	private readonly depth_margin: Box = {top: 630, right: 10, bottom: 20, left: 60};
	private depth_width: number;
	private depth_height: number;
	private drawing: boolean = true;
	private tid: number = 0;
	private rid: number = 0;

	private svg: d3.Selection<SVGSVGElement, unknown, HTMLElement, unknown>;
	private focus: d3.Selection<SVGGElement, Context, SVGSVGElement, unknown>;
	private focus_legend: d3.Selection<SVGGElement, Legend, SVGSVGElement, unknown>;
	private summary: d3.Selection<SVGGElement, Context, SVGSVGElement, unknown>;
	private depth: d3.Selection<SVGGElement, Depth, SVGSVGElement, unknown>;
	private depth_area: d3.Selection<SVGGElement, Depth, SVGSVGElement, unknown>;

	private focus_x: d3.ScaleTime<number, number>;
	private focus_y: d3.ScaleLinear<number, number>;
	private focus_xAxis: d3.Axis<Date>;
	private focus_yAxis: d3.Axis<number | { valueOf(): number; }>;
	private focus_line: d3.Line<ChartContextData>;
	private focus_path_d: (d: Context) => string | null;

	private summary_x: d3.ScaleTime<number, number>;
	private summary_y: d3.ScaleLinear<number, number>;
	private summary_xAxis: d3.Axis<Date>;
	private summary_yAxis: d3.Axis<number | { valueOf(): number; }>;
	private summary_line: d3.Line<ChartContextData>;
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
	private summary_path_stroke: (d: {name: string}) => string;
	private focus_legend_transform: (d: Legend, i: number) => string;
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
	private ydtmp: readonly [ChartContextData, ChartContextData];
	private datamap: {[key in Signal]?: boolean} = {};

	private draw_focus: boolean = false;
	private draw_summary: boolean = false;
	private draw_summary_old_date: Date = new Date();
	private draw_depth: boolean = false;
	private focus_domain_yaxis_update: boolean = false;
	private focus_xaxis_sec: number = 120;

	constructor(obj: Readonly<Stream>) {
		this.focus_width = 850 - this.focus_margin.left - this.focus_margin.right;
		this.focus_height = 500 - this.focus_margin.top - this.focus_margin.bottom;
		this.summary_width = 850 - this.summary_margin.left - this.summary_margin.right;
		this.summary_height = 620 - this.summary_margin.top - this.summary_margin.bottom;
		this.depth_width = 850 - this.depth_margin.left - this.depth_margin.right;
		this.depth_height = 760 - this.depth_margin.top - this.depth_margin.bottom;
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
		this.focus_line = d3.line<ChartContextData>()
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
		this.summary_line = d3.line<ChartContextData>()
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
				if(depth >= 1000000){
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
/*
		this.text_transform = (d, i) => {
			const dd = d.values[d.values.length - 1];
			return "translate(" + (this.focus_x(dd.date) - 80) + "," + (this.focus_y(dd.data) - 11) + ")";
		};
		this.text_update = d => d.name + " " + d.values[d.values.length - 1].data;
*/
		this.focus_legend_transform = (d: Legend, i: number): string => `translate(${(i * 150) + 66},0)`;
		this.focus_legend_update = (d: Legend): string => `${d.name} ${d.last_price.toLocaleString()}`;

		// オブジェクト構築
		this.init(obj);

		this.svg = d3.select("#" + svgID).append("svg");
		this.svg
			.attr("width", this.focus_width + this.focus_margin.left + this.focus_margin.right + 10)
			.attr("height", this.depth_height + this.depth_margin.top + this.depth_margin.bottom + 10);

		this.focus = this.svg.selectAll<SVGGElement, Context>(".focus")
			.data(this.focus_data)
			.enter().append("g")
			.attr("transform", `translate(${this.focus_margin.left},${this.focus_margin.top})`)
			.attr("class", "focus");

		this.focus_legend = this.svg.selectAll<SVGGElement, Legend>(".focus-legend")
			.data(this.focus_data_legend)
			.enter().append("g")
			.attr("transform", "translate(0,0)")
			.attr("class", "focus-legend");

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

		this.depth_area = this.svg.selectAll<SVGGElement, Depth>(".depth_area")
			.data(this.depth_data)
			.enter().append("g")
			.attr("transform", `translate(${this.depth_margin.left},${this.depth_margin.top})`)
			.attr("class", "depth_area");

		this.focus.append("path")				// 拡大グラフ
			.attr("class", "line")
			.style("stroke", this.summary_path_stroke);

		this.focus.append("g") 					// x目盛軸
			.attr("class", "x axis")
			.attr("transform", `translate(0,${this.focus_height})`)
			.call(this.focus_xAxis);

		this.focus.append("g")					// y目盛軸
			.attr("class", "y axis")
			.call(this.focus_yAxis);
/*
		this.focus.append("text")				// 凡例
			.attr("class", "legend user")
			.attr("x", 3)
			.attr("dy", ".35em")
			.text(this.text_update);
*/
		this.focus_legend.append('rect')		// 凡例の色付け四角
			.attr("x", 0)
			.attr("y", 10)
			.attr("width", 10)
			.attr("height", 10)
			.style("fill", this.summary_path_stroke)
			.attr("transform", this.focus_legend_transform);

		this.focus_legend.append('text')		// 凡例の文言
			.attr("x", 20)
			.attr("y", 20)
			.text(this.focus_legend_update)
			.attr("class", "focus-legend-text")
			.style("text-anchor", "start")
			.attr("transform", this.focus_legend_transform);

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

		this.depth.append("path")				// 深さグラフ
			.attr("class", "line")
			.style("stroke", this.summary_path_stroke);

		this.depth_area.append("path")			// 深さグラフ領域
			.attr("class", "depth_area_path")
			.attr("opacity", .3)
			.style("fill", this.summary_path_stroke);

		this.depth.append("g") 					// 深さx目盛軸
			.attr("class", "x axis")
			.attr("transform", `translate(0,${this.depth_height})`)
			.call(this.depth_xAxis);

		this.depth.append("g")					// 深さy目盛軸
			.attr("class", "y axis")
			.call(this.depth_yAxis);
	}
	private init(data: Readonly<Stream>): void {
		this.summary_color.domain([]);
		this.addsig(data);
		//this.addContext(data);
		//this.addDepth(data);
		this.startTimer(focusUpdateIntervalFPS);
	}
	private startTimer(fps: number): void {
		if(fps){
			this.tid = window.setInterval((): void => {
				const data: Stream = {
					Name: "",
					Date: new Date(),
					Signals: {
						"Asks": {Data: 0},
						"Bids": {Data: 0},
						"LastPrice": {Data: 0}
					}
				};
				let flag = false;
				for(const it of this.focus_data){
					if(it.values.length > 0 && data.Signals !== undefined){
						data.Signals[it.name] = {
							Data: it.values[it.values.length - 1].data
						};
						flag = true;
					}
				}
				if(flag){
					this.addContext(data);
					this.updateContextDomain();
					this.draw();
				}
			}, 1000 / fps);
		}
	}
	private stopTimer(): void {
		if(this.tid){
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
		if(this.rid){
			window.cancelAnimationFrame(this.rid);
			this.rid = 0;
		}
		const doc = document.getElementById(svgID);
		if(doc){
			doc.innerHTML = "";
		}
	}
	private addsig(data: Readonly<Stream>): boolean {
		const date = data.Date;
		const sigs = data.Signals;
		let ret = false;
		for(const key in sigs){
			if(isSignal(key) && sigs.hasOwnProperty(key) && this.datamap[key] === undefined){
				const data = (sigs[key] || {Data: 0}).Data;
				const summary_color = this.summary_color.domain();
				summary_color.push(key);
				this.summary_color.domain(summary_color);
				const newobj = (): Context => {
					return {
						name: key,
						values: [{
							date: date,
							data: data
						}]
					};
				};
				this.context_data.push(newobj());
				this.focus_data.push(newobj());
				this.summary_data.push(newobj());
				this.focus_data_legend.push({
					name: key,
					last_price: 0
				});
				this.datamap[key] = true;
				ret = true;
			}
		}
		return ret;
	}
	// copy on write的な戦略でメモリ管理する
	private static appendData(data: Context, val: Readonly<ChartContextData>, realtime?: boolean): boolean {
		let ret = false;
		const dv = data.values;
		const old = dv.length > 0 ? dv[dv.length - 1] : undefined;
		// 点の数を減らす処理
		if(old !== undefined){
			if(realtime){
				// リアルタイム性が欲しい場合
				const oldold = dv.length > 1 ? dv[dv.length - 2] : undefined;
				if((oldold !== undefined) && (oldold.data === old.data) && (old.data === val.data)){
					// 2つ前と1つ前と今回のデータが同じ場合
					// 1つ前のデータを今回の時間に更新
					dv[dv.length - 1] = {
						date: val.date,
						data: old.data
					}
				} else {
					dv.push(val);
					ret = true;
				}
			} else if(old.data !== val.data){
				// 違うデータの場合のみ更新
				dv.push(val);
				ret = true;
			}
		} else {
			dv.push(val);
			ret = true;
		}
		return ret;
	}
	public addContext(data: Readonly<Stream>): void {
		const date = data.Date;
		const datestart = new Date(Date.now() - (this.focus_xaxis_sec * 1000));
		const l = this.focus_data.length;
		const sigs = data.Signals;
		for(let i = 0; i < l; i++){
			const fd = this.focus_data[i];
			const sd = this.summary_data[i];
			const cd = this.context_data[i];
			const key = fd.name;
			if(sigs && sigs[key] !== undefined){
				const d = sigs[key].Data;
				const ccd: ChartContextData = {
					date: date,
					data: d
				};
				Graph.appendData(fd, ccd, true);
				this.draw_focus = true;
				const update = Graph.appendData(cd, ccd);
				this.focus_data_legend[i].last_price = d;
				// データサイズが大きくなり過ぎないように調節
				while(fd.values.length > 1000){
					fd.values.shift();
				}
				while((fd.values.length > 2) && (fd.values[0].date < datestart) && (fd.values[1].date < datestart)){
					fd.values.shift();
				}
				while(cd.values.length > 5000){
					cd.values.shift();
				}
				if(update && sd.values.length > 250){
					// contextを要約してsummaryを作る
					sd.values = Graph.LTTB(cd.values, 200);
				} else if(update){
					// summaryにも追加
					Graph.appendData(sd, ccd);
				}
				if(sd.values.length < 3){
					this.draw_summary = true;
				}
			}
		}
		// 一定時間経過でsummary更新
		if((date.getTime() - summaryUpdateInterval) > this.draw_summary_old_date.getTime()){
			this.draw_summary = true;
			this.draw_summary_old_date = date;
		}
	}
	public addDepth(data: Readonly<Stream>): void {
		const deps = data.Depths || {};
		[deps.Asks, deps.Bids].forEach((it, i) => {
			if(it){
				let dep = 0;
				this.depth_data[i].values = it.map((price: readonly [number, number]): ChartDepthData => {
					dep += price[0] * price[1];
					return {price: price[0], depth: dep};
				});
				this.depth_data[i].values.unshift({
					price: it[0][0],
					depth: 0
				});
				this.draw_depth = true;
			}
		});
	}
	public static contextMinFunc(num: number, it: ChartContextData): number {
		return (num < it.data) ? num : it.data;
	}
	public static contextMaxFunc(num: number, it: ChartContextData): number {
		return (num > it.data) ? num : it.data;
	}
	public updateContextDomain(all = false): void {
		const date = new Date();
		const datestart = new Date(date.getTime() - (this.focus_xaxis_sec * 1000));
		const focus_xd = [datestart, date];
		const summary_xd = this.summary_x.domain();
		const summary_yd = this.summary_y.domain();
		const ydtmp = this.ydtmp;
		summary_xd[0] = date;
		summary_xd[1] = date;

		// 縦軸の値の幅を設定
		if(this.focus_domain_yaxis_update === false && all === false){
			for(const fd of this.focus_data){
				const l = fd.values.length - 1;
				if(l >= 0){
					const data = fd.values[l].data;
					if(ydtmp[0].data > data){
						ydtmp[0].date = date;
						ydtmp[0].data = data;
					} else if(ydtmp[1].data < data){
						ydtmp[1].date = date;
						ydtmp[1].data = data;
					}
				}
			}
		}
		// 現在の最大最小が表示外になった場合
		if(ydtmp[0].date < datestart || this.focus_domain_yaxis_update || all){
			ydtmp[0].data = this.focus_data.reduce((num, it) => {
				const data = it.values.reduce(Graph.contextMinFunc, PriceMax);
				return (num < data) ? num : data;
			}, PriceMax);
		}
		if(ydtmp[1].date < datestart || this.focus_domain_yaxis_update || all){
			ydtmp[1].data = this.focus_data.reduce((num, it) => {
				const data = it.values.reduce(Graph.contextMaxFunc, PriceMin);
				return (num > data) ? num : data;
			}, PriceMin);
		}
		if(all){
			for(const cd of this.summary_data){
				summary_yd[0] = cd.values.reduce(Graph.contextMinFunc, summary_yd[0]);
				summary_yd[1] = cd.values.reduce(Graph.contextMaxFunc, summary_yd[1]);
				if(summary_xd[0] > cd.values[0].date){
					summary_xd[0] = cd.values[0].date;
				}
			}
		} else {
			for(const cd of this.summary_data){
				const l = cd.values.length - 1;
				if(l >= 0){
					const data = cd.values[l].data;
					// 最大値の更新
					if(summary_yd[0] > data){
						summary_yd[0] = data;
					}
					if(summary_yd[1] < data){
						summary_yd[1] = data;
					}
					if(summary_xd[0] > cd.values[0].date){
						summary_xd[0] = cd.values[0].date;
					}
				}
			}
		}
	
		this.focus_domain_yaxis_update = false;
		this.focus_x.domain(focus_xd);
		this.summary_x.domain(summary_xd);
		this.focus_y.domain([ydtmp[0].data, ydtmp[1].data]).nice();
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
		for(let i = 0; i < l; i++){
			this.focus_data[i].values.sort((a, b): number => a.date.getTime() - b.date.getTime());
			this.context_data[i].values.sort((a, b): number => a.date.getTime() - b.date.getTime());
			this.summary_data[i].values.sort((a, b): number => a.date.getTime() - b.date.getTime());
		}
	}
	public setFocusXAxis(sec: number = 120): void {
		const datestart = new Date(Date.now() - (sec * 1000));
		const l = this.focus_data.length;
		for(let i = 0; i < l; i++){
			const cv = this.context_data[i].values;
			const j = cv.findIndex(it => it.date >= datestart);
			if(j >= 0){
				this.focus_data[i].values = cv.slice(j);
			}
		}
		this.focus_domain_yaxis_update = true;
		this.focus_xaxis_sec = sec;
	}
	public draw(all = false): void {
		if(all){
			this.draw_focus = true;
			this.draw_summary = true;
			this.draw_depth = true;
		}
		if(this.drawing){
			this.drawing = false;
			this.rid = window.requestAnimationFrame((): void => {
				this.drawsub();
			});
		}
	}
	private drawsub(): void {
		this.drawing = true;
		if(this.draw_focus){
			this.draw_focus = false;
			this.focus.select<SVGPathElement>("path").attr("d", this.focus_path_d);		// 拡大グラフアップデート
//			this.focus.select(".legend.user").attr("transform", this.text_transform).text(this.text_update);
			this.focus_legend.select<SVGTextElement>(".focus-legend-text").text(this.focus_legend_update);
			this.focus.select<SVGGElement>(".x.axis").call(this.focus_xAxis);			// 拡大x軸アップデート
			this.focus.select<SVGGElement>(".y.axis").call(this.focus_yAxis); 			// 拡大y軸アップデート
		}
		if(this.draw_summary){
			this.draw_summary = false;
			this.summary.select<SVGPathElement>("path").attr("d", this.summary_path_d);	// 全体グラフアップデート
			this.summary.select<SVGGElement>(".x.axis").call(this.summary_xAxis);		// 全体x軸アップデート
			this.summary_yAxis.tickValues(this.summary_y.domain());
			this.summary.select<SVGGElement>(".y.axis").call(this.summary_yAxis);		// 全体x軸アップデート
		}
		if(this.draw_depth){
			this.draw_depth = false;
			this.depth.select<SVGPathElement>("path").attr("d", this.depth_path_d);		// 深さグラフアップデート
			this.depth.select<SVGGElement>(".x.axis").call(this.depth_xAxis);			// 深さx軸アップデート
			this.depth.select<SVGGElement>(".y.axis").call(this.depth_yAxis); 			// 深さy軸アップデート
			this.depth_area.select<SVGPathElement>("path").attr("d", this.depth_area_d);// 深さグラフ領域アップデート
		}
	}

	// https://github.com/dgryski/go-lttb を参考に作成
	public static LTTB(data: readonly ChartContextData[], threshold: number): ChartContextData[] {
		if(threshold >= data.length || threshold == 0){
			return data as ChartContextData[];	// 無し
		}
		const abs = Math.abs;
		const floor = Math.floor;
		// 最初の点は残す
		const sampled: ChartContextData[] = [data[0]];
		// Bucket size. Leave room for start and end data points
		const every: Float = (data.length - 2) / (threshold - 2);
		let bucketStart: number = 1;
		let bucketCenter: number = floor(every) + 1;
		let a: number = 0;
		for(let i: number = 0; i < threshold - 2; i++){
			const bucketEnd: number = floor((i + 2) * every) + 1;

			// Calculate point average for next bucket (containing c)
			let avgRangeStart: number = bucketCenter
			let avgRangeEnd: number = bucketEnd

			if(avgRangeEnd >= data.length){
				avgRangeEnd = data.length;
			}
			// float
			const avgRangeLength: Float = avgRangeEnd - avgRangeStart;
			let avgX: Float = 0;
			let avgY: Float = 0;
			for(; avgRangeStart < avgRangeEnd; avgRangeStart++){
				avgX += data[avgRangeStart].date.getTime();
				avgY += data[avgRangeStart].data;
			}
			avgX /= avgRangeLength;
			avgY /= avgRangeLength;
			// Point a
			const pointAX = data[a].date.getTime();
			const pointAY = data[a].data;
			let maxArea: Float = PriceMin;
			for(; bucketStart < bucketCenter; bucketStart++){
				const d = data[bucketStart];
				// Calculate triangle area over three buckets
				const area = abs(((pointAX - avgX) * (d.data - pointAY)) - ((pointAX - d.date.getTime()) * (avgY - pointAY)));
				if(area > maxArea){
					maxArea = area;
					a = bucketStart;			// Next a is this b
				}
			}
			sampled.push(data[a]);				// Pick this point from the bucket
			bucketCenter = bucketEnd;
		}
		sampled.push(data[data.length - 1]);	// Always add last
		return sampled;
	}
}

class Client {
	private graph?: Graph = undefined;
	private readonly ws: WebSocket;
	private readonly currency_pair: CurrencyPair;

	constructor(hash: string = "#btc_jpy"){
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
			if(isZaifStream(obj)){
				this.update(obj);
			}
		};
	}
	public dispose(): void {
		this.ws.close();
		if(this.graph !== undefined){
			this.graph.dispose();
			this.graph = undefined;
		}
	}
	private static getCurrencyPair(hash: string = "#btc_jpy"): CurrencyPair {
		const cp = hash.slice(1);
		return currency_pair_list.find(data => data === cp) || currency_pair_list[0];
	}
	private getWebsocketURL(): string {
		return streamBaseURL + this.currency_pair;
	}
	private static getDirection(action: DirectionEng): Direction {
		return action === "ask" ? "▼" : "▲";
	}
	private update(obj: Readonly<ZaifStream>){
		const data: Stream = {
			Name: obj.currency_pair,
			Date: new Date(),
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
		if(this.graph === undefined){
			this.createGraph(data);
		}
		this.addData(data);
		// vue用
		this.updateView(obj);
	}
	private updateView(obj: Readonly<ZaifStream>): void {
		const cp: readonly string[] = this.currency_pair.split("_");
		for(const key in dispdata.currencys){
			if(isCurrencyPair(key) && dispdata.currencys.hasOwnProperty(key)){
				dispdata.currencys[key].active = "";
			}
		}
		dispdata.currencys[this.currency_pair].active = "active";
		dispdata.currency_pair.first = cp[0];
		dispdata.currency_pair.second = cp[1];
		dispdata.last_trade.price = obj.last_price.price.toLocaleString();
		dispdata.last_trade.action = Client.getDirection(obj.last_price.action);
		dispdata.last_trade.type = obj.last_price.action;
		document.title = dispdata.last_trade.action
			+ ` ${dispdata.last_trade.price}`
			+ ` (${dispdata.currency_pair.first}/${dispdata.currency_pair.second}) 取引の様子`
			+ ` - zaifの取引情報を表示するやつ`;
		const tr: TradeView[] = [];
		for(let i = obj.trades.length - 1; i >= 0; i--){
			const it = obj.trades[i];
			let dir: Direction | "" = "";
			if(tr.length === 0){
				dir = Client.getDirection(it.trade_type);
			} else {
				if(tr[0].trade_type === it.trade_type && tr[0].price_orig !== it.price){
					dir = Client.getDirection(it.trade_type);
				} else if(tr[0].trade_type !== it.trade_type){
					dir = Client.getDirection(it.trade_type);
				}
			}
			tr.unshift({
				trade_type: it.trade_type,
				direction: dir,
				price_orig: it.price,
				price: it.price.toLocaleString(),
				amount: it.amount,
				date: timeFormat(new Date(it.date * 1000))
			});
		}
		dispdata.trades = tr;
		dispdata.bids = this.analyzeBoard(obj.bids);
		dispdata.asks = this.analyzeBoard(obj.asks);
		dispdata.date_diff = (Date.parse(obj.timestamp) - Date.now()) / 1000;
	}
	private analyzeBoard(data: readonly [number, number][]): readonly Board[] {
		let dep = 0;
		return data.map(it => {
			dep += it[0] * it[1];
			return {
				price: it[0].toLocaleString(),
				amount: it[1],
				depth: (dep | 0).toLocaleString()
			};
		});
	}
	public setGraphFocusXAxis(sec: number): void {
		if(this.graph !== undefined){
			this.graph.setFocusXAxis(sec);
		}
	}
	public setGraphFocusFPS(fps: number): void {
		if(this.graph !== undefined){
			this.graph.restartTimer(fps);
		}
	}
	private createGraph(obj: Readonly<Stream>): void {
		this.graph = new Graph(obj);
	}
	private addData(obj: Readonly<Stream>): void {
		if(this.graph !== undefined){
			this.graph.addContext(obj);
			this.graph.addDepth(obj);
			this.graph.updateContextDomain();
			this.graph.updateDepthDomain();
			this.graph.draw();
		}
	}
	private loadHistory(): void {
		const url = historyDataURL + this.currency_pair;
		const xhr = new XMLHttpRequest();
		xhr.ontimeout = (): void => {
			console.error(`The request for ${url} timed out.`);
		};
		xhr.onload = (e): void => {
			if(xhr.readyState === 4){
				if(xhr.status === 200){
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
		for(const it of data){
			if(it.ask !== undefined){
				ask = it.ask;
			}
			if(it.bid !== undefined){
				bid = it.bid;
			}
			if(it.trade !== undefined){
				trade = it.trade;
			}
			if(ask !== undefined && bid !== undefined && trade !== undefined){
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
				if(this.graph === undefined){
					this.createGraph(obj);
				}
				if(this.graph){
					this.graph.addContext(obj);
				}
			}
		}
		if(ask !== undefined && bid !== undefined && trade !== undefined && this.graph){
			this.graph.sortContext();
			this.graph.updateContextDomain(true);
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
			selected: 120,
			options: [
				{text: "1分", value: 60},
				{text: "2分", value: 120},
				{text: "5分", value: 300},
				{text: "10分", value: 600},
				{text: "30分", value: 1800}
			]
		},
		fps: {
			selected: 10,
			options: [
				{text: "無し", value: 0},
				{text: "1fps", value: 1},
				{text: "5fps", value: 5},
				{text: "10fps", value: 10},
				{text: "30fps", value: 30},
				{text: "60fps", value: 60}
			]
		}
	},
	currency_pair: {
		first: "btc",
		second: "jpy"
	},
	date_diff: 0,
	currencys: {
		btc_jpy: {name: "btc/jpy", hash: "#btc_jpy", active: ""},
		xem_jpy: {name: "xem/jpy", hash: "#xem_jpy", active: ""},
		mona_jpy: {name: "mona/jpy", hash: "#mona_jpy", active: ""},
		bch_jpy: {name: "bch/jpy", hash: "#bch_jpy", active: ""},
		eth_jpy: {name: "eth/jpy", hash: "#eth_jpy", active: ""}
	}
};
const vm = new Vue({
	el: "#container",
	data: dispdata,
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
	dispdata.focus.xaxis.selected = 120;
	dispdata.focus.fps.selected = 10;
	if(cli != null){
		cli.dispose();
	}
	cli = new Client(location.hash);
}, false);
