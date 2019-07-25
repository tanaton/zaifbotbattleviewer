import * as d3 from 'd3';
import Vue from 'vue';

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

const svgID: string = "svgarea";
const streamBaseURL: string = "wss://ws.zaif.jp/stream?currency_pair=";
const historyDataURL: string = "/api/zaif/1/oldstream/";
const currency_pair_list: readonly CurrencyPair[] = ["btc_jpy", "xem_jpy", "mona_jpy", "bch_jpy", "eth_jpy"];
const timeFormat = d3.timeFormat("%H:%M:%S");
const floatFormat = d3.format(".1f");

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

type Stream = {
	readonly Name: CurrencyPair | "";
	readonly Date: Date;
	readonly Signals?: {
		[key in Signal]?: {
			readonly Data: number;
		};
	};
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
	private readonly context_margin: Box = {top: 510, right: 10, bottom: 20, left: 60};
	private context_width: number;
	private context_height: number;
	private readonly depth_margin: Box = {top: 630, right: 10, bottom: 20, left: 60};
	private depth_width: number;
	private depth_height: number;
	private drawing: boolean = true;
	private tid: number = 0;
	private rid: number = 0;

	private svg: d3.Selection<SVGSVGElement, unknown, HTMLElement, unknown>;
	private focus: d3.Selection<SVGGElement, Context, SVGSVGElement, unknown>;
	private focus_legend: d3.Selection<SVGGElement, Legend, SVGSVGElement, unknown>;
	private context: d3.Selection<SVGGElement, Context, SVGSVGElement, unknown>;
	private depth: d3.Selection<SVGGElement, Depth, SVGSVGElement, unknown>;
	private depth_area: d3.Selection<SVGGElement, Depth, SVGSVGElement, unknown>;

	private focus_x: d3.ScaleTime<number, number>;
	private focus_y: d3.ScaleLinear<number, number>;
	private focus_xAxis: d3.Axis<Date>;
	private focus_yAxis: d3.Axis<number | { valueOf(): number; }>;
	private focus_line: d3.Line<ChartContextData>;
	private focus_path_d: (d: Context) => string | null;

	private context_x: d3.ScaleTime<number, number>;
	private context_y: d3.ScaleLinear<number, number>;
	private context_xAxis: d3.Axis<Date>;
	private context_yAxis: d3.Axis<number | { valueOf(): number; }>;
	private context_line: d3.Line<ChartContextData>;
	private context_path_d: (d: Context) => string | null;

	private depth_x: d3.ScaleLinear<number, number>;
	private depth_y: d3.ScaleLinear<number, number>;
	private depth_xAxis: d3.Axis<number | { valueOf(): number; }>;
	private depth_yAxis: d3.Axis<number>;
	private depth_line: d3.Line<ChartDepthData>;
	private depth_path_d: (d: Depth) => string | null;
	private depth_line_area: d3.Area<ChartDepthData>;
	private depth_area_d: (d: Depth) => string | null;

	private context_color: d3.ScaleOrdinal<string, string>;
	private context_path_stroke: (d: {name: string}) => string;
	private focus_legend_transform: (d: Legend, i: number) => string;
	private focus_legend_update: (d: Legend) => string;

	private focus_data: Context[] = [];
	private focus_data_legend: Legend[] = [];
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
	private draw_context: boolean = false;
	private draw_depth: boolean = false;
	private focus_domain_yaxis_update: boolean = false;
	private focus_xaxis_sec: number = 120;

	constructor(obj: Readonly<Stream>) {
		this.focus_width = 850 - this.focus_margin.left - this.focus_margin.right;
		this.focus_height = 500 - this.focus_margin.top - this.focus_margin.bottom;
		this.context_width = 850 - this.context_margin.left - this.context_margin.right;
		this.context_height = 620 - this.context_margin.top - this.context_margin.bottom;
		this.depth_width = 850 - this.depth_margin.left - this.depth_margin.right;
		this.depth_height = 760 - this.depth_margin.top - this.depth_margin.bottom;
		this.ydtmp = [{
			date: obj.Date,
			data: 10000000
		}, {
			date: obj.Date,
			data: -10000000
		}];

		this.focus_x = d3.scaleTime()
			.domain([0, 0])
			.range([0, this.focus_width]);
		this.focus_y = d3.scaleLinear()
			.domain([10000000, -10000000])
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

		this.context_x = d3.scaleTime()
			.domain(this.focus_x.domain())
			.range([0, this.context_width]);
		this.context_y = d3.scaleLinear()
			.domain(this.focus_y.domain())
			.range([this.context_height, 0]);
		this.context_xAxis = d3.axisBottom<Date>(this.context_x)
			.tickSizeInner(-this.context_height)
			.tickFormat(timeFormat)
			.tickPadding(7)
			.ticks(5);
		this.context_yAxis = d3.axisLeft(this.context_y)
			.tickSizeInner(-this.context_width)
			.tickPadding(7);
		this.context_line = d3.line<ChartContextData>()
			//.curve(d3.curveLinear)
			.curve(d3.curveStepAfter)
			.x(d => this.context_x(d.date))
			.y(d => this.context_y(d.data));
		this.context_path_d = d => this.context_line(d.values);

		this.depth_x = d3.scaleLinear()
			.domain([0, 0])
			.range([0, this.depth_width]);
		this.depth_y = d3.scaleLinear()
			.domain([10000000, -10000000])
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

		this.context_color = d3.scaleOrdinal<string>().range(["#b94047", "#47ba41", "#4147ba", "#bab441", "#41bab4", "#b441ba"]);
		this.context_path_stroke = d => this.context_color(d.name);
/*
		this.text_transform = (d, i) => {
			const dd = d.values[d.values.length - 1];
			return "translate(" + (this.focus_x(dd.date) - 80) + "," + (this.focus_y(dd.data) - 11) + ")";
		};
		this.text_update = d => d.name + " " + d.values[d.values.length - 1].data;
*/
		this.focus_legend_transform = (d: Legend, i: number): string => {
			return `translate(${(i * 150) + 66},0)`;
		}
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

		this.context = this.svg.selectAll<SVGGElement, Context>(".context")
			.data(this.context_data)
			.enter().append("g")
			.attr("transform", `translate(${this.context_margin.left},${this.context_margin.top})`)
			.attr("class", "context");

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
			.style("stroke", this.context_path_stroke);

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
			.style("fill", this.context_path_stroke)
			.attr("transform", this.focus_legend_transform);

		this.focus_legend.append('text')		// 凡例の文言
			.attr("x", 20)
			.attr("y", 20)
			.text(this.focus_legend_update)
			.attr("class", "focus-legend-text")
			.style("text-anchor", "start")
			.attr("transform", this.focus_legend_transform);

		this.context.append("path")				// 全体グラフ
			.attr("class", "line")
			.style("stroke", this.context_path_stroke);

		this.context.append("g")				// 全体x目盛軸
			.attr("class", "x axis")
			.attr("transform", `translate(0,${this.context_height})`)
			.call(this.context_xAxis);

		this.context.append("g")				// 全体y目盛軸
			.attr("class", "y axis")
			.call(this.context_yAxis);

		this.depth.append("path")				// 深さグラフ
			.attr("class", "line")
			.style("stroke", this.context_path_stroke);

		this.depth_area.append("path")			// 深さグラフ領域
			.attr("class", "depth_area_path")
			.attr("opacity", .3)
			.style("fill", this.context_path_stroke);

		this.depth.append("g") 					// 深さx目盛軸
			.attr("class", "x axis")
			.attr("transform", `translate(0,${this.depth_height})`)
			.call(this.depth_xAxis);

		this.depth.append("g")					// 深さy目盛軸
			.attr("class", "y axis")
			.call(this.depth_yAxis);
	}
	private init(data: Readonly<Stream>): void {
		this.context_color.domain([]);
		this.addsig(data);
		//this.addContext(data);
		//this.addDepth(data);

		this.tid = window.setInterval((): void => {
			const data: Stream = {
				Name: "",
				Date: new Date(),
				Signals: {}
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
				this.draw();
			}
		}, 1000 / 30);
	}
	public dispose(): void {
		if(this.tid){
			window.clearInterval(this.tid);
		}
		if(this.rid){
			window.cancelAnimationFrame(this.rid);
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
				const context_color = this.context_color.domain();
				context_color.push(key);
				this.context_color.domain(context_color);
				this.focus_data.push({
					name: key,
					values: [{
						date: date,
						data: data
					}]
				});
				this.focus_data_legend.push({
					name: key,
					last_price: 0
				});
				this.context_data.push({
					name: key,
					values: [{
						date: date,
						data: data
					}]
				});
				this.datamap[key] = true;
				ret = true;
			}
		}
		return ret;
	}
	private static appendData(data: Context, val: Readonly<ChartContextData>): boolean {
		let ret = false;
		const old = data.values.length > 0 ? data.values[data.values.length - 1] : undefined;
		// 点の数を減らす処理
		if(old !== undefined){
			const oldold = data.values.length > 1 ? data.values[data.values.length - 2] : undefined;
			if((oldold !== undefined) && (oldold.data === old.data) && (old.data === val.data)){
				// 2つ前と1つ前と今回のデータが同じ場合
				// 1つ前のデータを今回のデータに更新
				data.values[data.values.length - 1].date = val.date;
			} else {
				data.values.push(val);
				ret = true;
			}
		} else {
			data.values.push(val);
			ret = true;
		}
		return ret;
	}
	public addContext(data: Readonly<Stream>): void {
		const date = data.Date;
		const datestart = new Date(Date.now() - (this.focus_xaxis_sec * 1000));
		const l = this.focus_data.length;
		const sigs = data.Signals || {};
		for(let i = 0; i < l; i++){
			const it = this.focus_data[i];
			const it2 = this.context_data[i];
			const key = it.name;
			if(sigs[key] !== undefined){
				const d = (sigs[key] || {Data: 0}).Data;
				Graph.appendData(it, {
					date: date,
					data: d
				});
				this.draw_focus = true;
				const update = Graph.appendData(it2, {
					date: date,
					data: d
				});
				if(update || it2.values.length < 100){
					this.draw_context = true;
				}
				this.focus_data_legend[i].last_price = d;
				// データサイズが大きくなり過ぎないように調節
				while(it.values.length > 2000){
					it.values.shift();
				}
				while((it.values.length > 2) && (it.values[0].date < datestart) && (it.values[1].date < datestart)){
					it.values.shift();
				}
				while(it2.values.length > 5000){
					it2.values.shift();
				}
			}
		}
		this.updateContextDomain(data);
	}
	public addDepth(data: Readonly<Stream>): void {
		const deps = data.Depths || {};
		const asks: ChartDepthData[] = [];
		const bids: ChartDepthData[] = [];
		let dep = 0;
		if(deps.Asks){
			asks.push({
				price: deps.Asks[0][0],
				depth: 0
			});
			for(const ask of deps.Asks){
				dep += ask[0] * ask[1];
				asks.push({
					price: ask[0],
					depth: dep
				});
			}
		}
		dep = 0;
		if(deps.Bids){
			bids.push({
				price: deps.Bids[0][0],
				depth: 0
			});
			for(const bid of deps.Bids){
				dep += bid[0] * bid[1];
				bids.push({
					price: bid[0],
					depth: dep
				});
			}
		}
		this.depth_data[0].values = asks;
		this.depth_data[1].values = bids;
		this.draw_depth = true;
		this.updateDepthDomain();
	}
	private updateContextDomain(data: Readonly<Stream>): void {
		const date = data.Date;
		const datestart = new Date(+date - (this.focus_xaxis_sec * 1000));
		const focus_xd = [datestart, date];
		const sigs = data.Signals || {};
		const context_xd = this.context_x.domain();
		const context_yd = this.context_y.domain();
		const ydtmp = this.ydtmp;
	
		context_xd[0] = date;
		context_xd[1] = date;
		// 縦軸の値の幅を設定
		const l = this.focus_data.length;
		for(let i = 0; i < l; i++){
			const key = this.focus_data[i].name;
			if(sigs[key] !== undefined){
				const data = (sigs[key] || {Data: 0}).Data;
				if(ydtmp[0].data > data){
					ydtmp[0].date = date;
					ydtmp[0].data = data;
				} else if(ydtmp[1].data < data){
					ydtmp[1].date = date;
					ydtmp[1].data = data;
				}
				// 最大値の更新
				if(context_yd[0] > data){
					context_yd[0] = data;
				}
				if(context_yd[1] < data){
					context_yd[1] = data;
				}
			}
			if(context_xd[0] > this.context_data[i].values[0].date){
				context_xd[0] = this.context_data[i].values[0].date;
			}
		}
		// 現在の最大最小が表示外になった場合
		if(ydtmp[0].date < datestart || this.focus_domain_yaxis_update){
			ydtmp[0].data = 10000000;
			for(const fd of this.focus_data){
				let it = d3.min(fd.values, it => it.data) || 0;
				if(ydtmp[0].data > it){
					ydtmp[0].data = it;
				}
			}
		}
		if(ydtmp[1].date < datestart || this.focus_domain_yaxis_update){
			ydtmp[1].data = -10000000;
			for(const fd of this.focus_data){
				let it = d3.max(fd.values, it => it.data) || 0;
				if(ydtmp[1].data < it){
					ydtmp[1].data = it;
				}
			}
		}
	
		this.focus_domain_yaxis_update = false;
		this.focus_x.domain(focus_xd);
		this.context_x.domain(context_xd);
		this.focus_y.domain([ydtmp[0].data, ydtmp[1].data]).nice();
		this.context_y.domain(context_yd).nice();
	}
	private updateDepthDomain(): void {
		const depth_xd = this.depth_x.domain();
		const depth_yd = this.depth_y.domain();
		const ydbidmax = d3.max(this.depth_data[1].values, it => it.depth) || 0;
		const ydaskmax = d3.max(this.depth_data[0].values, it => it.depth) || 0;

		depth_xd[0] = d3.min(this.depth_data[1].values, it => it.price) || 0;
		depth_xd[1] = d3.max(this.depth_data[0].values, it => it.price) || 0;
		depth_yd[0] = 0;
		if(ydaskmax > ydbidmax){
			depth_yd[1] = ydaskmax;
		} else {
			depth_yd[1] = ydbidmax;
		}

		this.depth_x.domain(depth_xd);
		this.depth_y.domain(depth_yd).nice();
	}
	public setFocusXAxis(sec: number = 120): void {
		const datestart = new Date(Date.now() - (sec * 1000));
		const l = this.focus_data.length;
		for(let i = 0; i < l; i++){
			const f = this.focus_data[i];
			const c = this.context_data[i];
			const j = c.values.findIndex(it => it.date >= datestart);
			if(j >= 0){
				f.values = c.values.slice(j);
			}
		}
		this.focus_domain_yaxis_update = true;
		this.focus_xaxis_sec = sec;
	}
	public draw(): void {
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
		if(this.draw_context){
			this.draw_context = false;
			this.context.select<SVGPathElement>("path").attr("d", this.context_path_d);	// 全体グラフアップデート
			this.context.select<SVGGElement>(".x.axis").call(this.context_xAxis);		// 全体x軸アップデート
			this.context_yAxis.tickValues(this.context_y.domain());
			this.context.select<SVGGElement>(".y.axis").call(this.context_yAxis);		// 全体x軸アップデート
		}
		if(this.draw_depth){
			this.draw_depth = false;
			this.depth.select<SVGPathElement>("path").attr("d", this.depth_path_d);		// 深さグラフアップデート
			this.depth.select<SVGGElement>(".x.axis").call(this.depth_xAxis);			// 深さx軸アップデート
			this.depth.select<SVGGElement>(".y.axis").call(this.depth_yAxis); 			// 深さy軸アップデート
			this.depth_area.select<SVGPathElement>("path").attr("d", this.depth_area_d);// 深さグラフ領域アップデート
		}
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
			const obj: ZaifStream = JSON.parse(msg.data);
			this.update(obj);
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
		const i = currency_pair_list.findIndex(data => data === cp);
		if(i < 0){
			return currency_pair_list[0];
		}
		return currency_pair_list[i];
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
		const board: Board[] = [];
		for(const it of data){
			dep += it[0] * it[1];
			board.push({
				price: it[0].toLocaleString(),
				amount: it[1],
				depth: (dep | 0).toLocaleString()
			});
		}
		return board;
	}
	public setGraphFocusXAxis(sec: number): void {
		if(this.graph !== undefined){
			this.graph.setFocusXAxis(sec);
		}
	}
	private createGraph(obj: Readonly<Stream>): void {
		this.graph = new Graph(obj);
	}
	private addData(obj: Readonly<Stream>): void {
		if(this.graph !== undefined){
			this.graph.addContext(obj);
			this.graph.addDepth(obj);
			this.graph.draw();
		}
	}
	private loadHistory(): void {
		const url = historyDataURL + this.currency_pair;
		const xhr = new XMLHttpRequest();
		xhr.ontimeout = () => {
			console.error(`The request for ${url} timed out.`);
		};
		xhr.onload = (e) => {
			if(xhr.readyState === 4){
				if(xhr.status === 200){
					console.log("履歴の取得に成功");
					this.addDataHistory(JSON.parse(xhr.responseText));
				} else {
					console.error(xhr.statusText);
				}
			}
		};
		xhr.onerror = (e) => {
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
			this.graph.draw();
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
		}
	}
});
let cli = new Client(location.hash);
window.addEventListener("hashchange", () => {
	if(cli != null){
		cli.dispose();
	}
	cli = new Client(location.hash);
}, false);
