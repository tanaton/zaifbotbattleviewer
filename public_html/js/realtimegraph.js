'use strict';

const svgID = "svgarea";
const streamBaseURL = "wss://ws.zaif.jp/stream?currency_pair=";
const historyDataURL = "/api/1/oldstream/";
const currency_pair_list = Object.freeze(["btc_jpy", "xem_jpy", "mona_jpy", "bch_jpy", "eth_jpy"]);
const timeFormat = d3.timeFormat("%H:%M:%S");
const floatFormat = d3.format(".1f");

class Graph {
	constructor(obj) {
		this._focus_margin = {top: 30, right: 10, bottom: 20, left: 60};
		this._focus_width = 850 - this._focus_margin.left - this._focus_margin.right;
		this._focus_height = 500 - this._focus_margin.top - this._focus_margin.bottom;
		this._context_margin = {top: 510, right: 10, bottom: 20, left: 60};
		this._context_width = 850 - this._context_margin.left - this._context_margin.right;
		this._context_height = 620 - this._context_margin.top - this._context_margin.bottom;
		this._depth_margin = {top: 630, right: 10, bottom: 20, left: 60};
		this._depth_width = 850 - this._depth_margin.left - this._depth_margin.right;
		this._depth_height = 760 - this._depth_margin.top - this._depth_margin.bottom;
		this._drawing = true;
		this._tid = 0;
		this._rid = 0;

		this._focus_data = [];
		this._focus_data_legend = [];
		this._context_data = [];
		this._depth_data = [{
			name: "Asks",
			values: []
		}, {
			name: "Bids",
			values: []
		}];
		this._datamap = {};
		this._ydtmp = [];
		this._draw_focus = false;
		this._draw_context = false;
		this._draw_depth = false;
		this._focus_xaxis_sec = 120;
		this._focus_domain_xaxis_update = false;
		this._focus_domain_yaxis_update = false;

		this.focus_x = d3.scaleLinear()
			.domain([0, 0])
			.range([0, this._focus_width]);
		this.focus_y = d3.scaleLinear()
			.domain([10000000, -10000000])
			.range([this._focus_height, 0]);
		this.focus_xAxis = d3.axisBottom(this.focus_x)
			.tickSizeInner(-this._focus_height)
			.tickFormat(timeFormat)
			.tickPadding(7)
			.ticks(5);
		this.focus_yAxis = d3.axisLeft(this.focus_y)
			.tickSizeInner(-this._focus_width)
			.tickPadding(7)
			.ticks(5);
		this.focus_line = d3.line()
			//.curve(d3.curveLinear)
			.curve(d3.curveStepAfter)
			.x(d => this.focus_x(d.date))
			.y(d => this.focus_y(d.data));
		this.focus_path_d = d => this.focus_line(d.values);

		this.context_x = d3.scaleLinear()
			.domain(this.focus_x.domain())
			.range([0, this._context_width]);
		this.context_y = d3.scaleLinear()
			.domain(this.focus_y.domain())
			.range([this._context_height, 0]);
		this.context_xAxis = d3.axisBottom(this.context_x)
			.tickSizeInner(-this._context_height)
			.tickFormat(timeFormat)
			.tickPadding(7)
			.ticks(5);
		this.context_yAxis = d3.axisLeft(this.context_y)
			.tickSizeInner(-this._context_width)
			.tickPadding(7);
		this.context_line = d3.line()
			//.curve(d3.curveLinear)
			.curve(d3.curveStepAfter)
			.x(d => this.context_x(d.date))
			.y(d => this.context_y(d.data));
		this.context_path_d = d => this.context_line(d.values);

		this.depth_x = d3.scaleLinear()
			.domain([0, 0])
			.range([0, this._depth_width]);
		this.depth_y = d3.scaleLinear()
			.domain([10000000, -10000000])
			.range([this._depth_height, 0]);
		this.depth_xAxis = d3.axisBottom(this.depth_x)
			.tickSizeOuter(-this._depth_height)
			.tickSizeInner(-this._depth_height)
			.tickPadding(7)
			.ticks(5);
		this.depth_yAxis = d3.axisLeft(this.depth_y)
			.tickSizeOuter(-this._depth_width)
			.tickSizeInner(-this._depth_width)
			.tickFormat((depth) => {
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
		this.depth_line = d3.line()
			.curve(d3.curveStepAfter)
			.x(d => this.depth_x(d.price))
			.y(d => this.depth_y(d.depth));
		this.depth_path_d = d => this.depth_line(d.values);
		this.depth_line_area = d3.area()
			.curve(d3.curveStepAfter)
			.x(d => this.depth_x(d.price))
			.y0(d => this.depth_y(0))
			.y1(d => this.depth_y(d.depth));
		this.depth_area_d = d => this.depth_line_area(d.values);

		this.context_color = d3.scaleOrdinal().range(["#b94047", "#47ba41", "#4147ba", "#bab441", "#41bab4", "#b441ba"]);
		this.context_path_stroke = d => this.context_color(d.name);
/*
		this.text_transform = (d, i) => {
			const dd = d.values[d.values.length - 1];
			return "translate(" + (this.focus_x(dd.date) - 80) + "," + (this.focus_y(dd.data) - 11) + ")";
		};
		this.text_update = d => d.name + " " + d.values[d.values.length - 1].data;
*/
		this.focus_legend_transform = (d, i) => {
			return "translate(" + ((i * 150) + 66) + ",0)";
		}
		this.focus_legend_update = d => d.name + " " + d.last_price.toLocaleString();

		// オブジェクト構築
		this.init(obj);

		this.svg = d3.select("#" + svgID).append("svg");
		this.svg
			.attr("width", this._focus_width + this._focus_margin.left + this._focus_margin.right + 10)
			.attr("height", this._depth_height + this._depth_margin.top + this._depth_margin.bottom + 10);

		this.focus = this.svg.selectAll(".focus")
			.data(this._focus_data)
			.enter().append("g")
			.attr("transform", "translate(" + this._focus_margin.left + "," + this._focus_margin.top + ")")
			.attr("class", "focus");

		this.focus_legend = this.svg.selectAll(".focus-legend")
			.data(this._focus_data_legend)
			.enter().append("g")
			.attr("transform", "translate(0,0)")
			.attr("class", "focus-legend");

		this.context = this.svg.selectAll(".context")
			.data(this._context_data)
			.enter().append("g")
			.attr("transform", "translate(" + this._context_margin.left + "," + this._context_margin.top + ")")
			.attr("class", "context");

		this.depth = this.svg.selectAll(".depth")
			.data(this._depth_data)
			.enter().append("g")
			.attr("transform", "translate(" + this._depth_margin.left + "," + this._depth_margin.top + ")")
			.attr("class", "depth");

		this.depth_area = this.svg.selectAll(".depth_area")
			.data(this._depth_data)
			.enter().append("g")
			.attr("transform", "translate(" + this._depth_margin.left + "," + this._depth_margin.top + ")")
			.attr("class", "depth_area");

		this.focus.append("path")				// 拡大グラフ
			.attr("class", "line")
			.style("stroke", this.context_path_stroke);

		this.focus.append("g") 					// x目盛軸
			.attr("class", "x axis")
			.attr("transform", "translate(0," + this._focus_height + ")")
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
			.attr("transform", "translate(0," + this._context_height + ")")
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
			.attr("transform", "translate(0," + this._depth_height + ")")
			.call(this.depth_xAxis);

		this.depth.append("g")					// 深さy目盛軸
			.attr("class", "y axis")
			.call(this.depth_yAxis);
	}
	init(data){
		const date = data.Date;
		this._ydtmp = [{
			date: date,
			data: 10000000
		}, {
			date: date,
			data: -10000000
		}];
		this.context_color.domain([]);
		this.addsig(data);
		//this.addContext(data);
		//this.addDepth(data);

		this._tid = window.setInterval(() => {
			let data = {
				Date: new Date(),
				Signals: {}
			};
			let flag = false;
			const l = this._focus_data.length;
			for(let i = 0; i < l; i++){
				let it = this._focus_data[i];
				if(it.values.length > 0){
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
	dispose(){
		if(this._tid){
			window.clearInterval(this._tid);
		}
		if(this._rid){
			window.cancelAnimationFrame(this._rid);
		}
		document.getElementById(svgID).innerHTML = "";
	}
	addsig(data){
		const date = data.Date;
		const sigs = data.Signals;
		let ret = false;
		for(const key in sigs){
			if(sigs.hasOwnProperty(key) && (this._datamap[key] == null)){
				let context_color = this.context_color.domain();
				context_color.push(key);
				this.context_color.domain(context_color);
				this._focus_data.push({
					name: key,
					values: [{
						date: date,
						data: sigs[key].Data
					}]
				});
				this._focus_data_legend.push({
					name: key,
					last_price: 0
				});
				this._context_data.push({
					name: key,
					values: [{
						date: date,
						data: sigs[key].Data
					}]
				});
				this._datamap[key] = true;
				ret = true;
			}
		}
		return ret;
	}
	static appendData(data, val){
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
	addContext(data){
		const date = data.Date;
		const datestart = new Date(Date.now() - (this._focus_xaxis_sec * 1000));
		const l = this._focus_data.length;
		const sigs = data.Signals;
		for(let i = 0; i < l; i++){
			let it = this._focus_data[i];
			let it2 = this._context_data[i];
			const key = it.name;
			if(sigs[key] !== undefined){
				Graph.appendData(it, {
					date: date,
					data: sigs[key].Data
				});
				this._draw_focus = true;
				const update = Graph.appendData(it2, {
					date: date,
					data: sigs[key].Data
				});
				if(update || it2.values.length < 100){
					this._draw_context = true;
				}
				this._focus_data_legend[i].last_price = sigs[key].Data;
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
	addDepth(data){
		const deps = data.Depths;
		const alen = deps.Asks.length;
		const blen = deps.Bids.length;
		let asks = [];
		let bids = [];
		let dep = 0;
		asks.push({
			price: deps.Asks[0][0],
			depth: 0
		});
		for(let i = 0; i < alen; i++){
			dep += deps.Asks[i][0] * deps.Asks[i][1];
			asks.push({
				price: deps.Asks[i][0],
				depth: dep
			});
		}
		dep = 0;
		bids.push({
			price: deps.Bids[0][0],
			depth: 0
		});
		for(let i = 0; i < blen; i++){
			dep += deps.Bids[i][0] * deps.Bids[i][1];
			bids.push({
				price: deps.Bids[i][0],
				depth: dep
			});
		}
		this._depth_data[0].values = asks;
		this._depth_data[1].values = bids;
		this._draw_depth = true;
		this.updateDepthDomain(data);
	}
	updateContextDomain(data){
		const date = data.Date;
		const datestart = new Date(date - (this._focus_xaxis_sec * 1000));
		const focus_xd = [datestart, date];
		const sigs = data.Signals;
		let context_xd = this.context_x.domain();
		let context_yd = this.context_y.domain();
		let ydtmp = this._ydtmp;
	
		context_xd[0] = date;
		context_xd[1] = date;
		// 縦軸の値の幅を設定
		const l = this._focus_data.length;
		for(let i = 0; i < l; i++){
			const key = this._focus_data[i].name;
			if(sigs[key] !== undefined){
				const data = sigs[key].Data;
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
			if(context_xd[0] > this._context_data[i].values[0].date){
				context_xd[0] = this._context_data[i].values[0].date;
			}
		}
		// 現在の最大最小が表示外になった場合
		if(ydtmp[0].date < datestart || this._focus_domain_yaxis_update){
			ydtmp[0].data = 10000000;
			const datalen = this._focus_data.length;
			for(let j = 0; j < datalen; j++){
				let it = d3.min(this._focus_data[j].values, it => it.data);
				if(ydtmp[0].data > it){
					ydtmp[0].data = it;
				}
			}
		}
		if(ydtmp[1].date < datestart || this._focus_domain_yaxis_update){
			ydtmp[1].data = -10000000;
			const datalen = this._focus_data.length;
			for(let j = 0; j < datalen; j++){
				let it = d3.max(this._focus_data[j].values, it => it.data);
				if(ydtmp[1].data < it){
					ydtmp[1].data = it;
				}
			}
		}
	
		this._focus_domain_yaxis_update = false;
		this.focus_x.domain(focus_xd);
		this.context_x.domain(context_xd);
		this.focus_y.domain([ydtmp[0].data, ydtmp[1].data]).nice();
		this.context_y.domain(context_yd).nice();
	}
	updateDepthDomain(data){
		let depth_xd = this.depth_x.domain();
		let depth_yd = this.depth_y.domain();
		const ydbidmax = d3.max(this._depth_data[1].values, it => it.depth);
		const ydaskmax = d3.max(this._depth_data[0].values, it => it.depth);

		depth_xd[0] = d3.min(this._depth_data[1].values, it => it.price);
		depth_xd[1] = d3.max(this._depth_data[0].values, it => it.price);
		depth_yd[0] = 0;
		if(ydaskmax > ydbidmax){
			depth_yd[1] = ydaskmax;
		} else {
			depth_yd[1] = ydbidmax;
		}

		this.depth_x.domain(depth_xd);
		this.depth_y.domain(depth_yd).nice();
	}
	setFocusXAxis(sec = 120){
		const datestart = new Date(Date.now() - (sec * 1000));
		const l = this._focus_data.length;
		for(let i = 0; i < l; i++){
			const f = this._focus_data[i];
			const c = this._context_data[i];
			const clen = c.length;
			let j = 0;
			for(j = 0; j < clen; j++){
				if(c.values[j].date >= datestart){
					break;
				}
			}
			f.values = c.values.slice(j);
			//f.values = c.values.filter(it => it.date >= datestart);
		}
		this._focus_domain_yaxis_update = true;
		this._focus_xaxis_sec = sec;
	}
	draw(){
		if(this._drawing){
			this._drawing = false;
			this._rid = window.requestAnimationFrame((timestamp) => {
				this.drawsub();
			});
		}
	}
	drawsub(){
		this._drawing = true;
		if(this._draw_focus){
			this._draw_focus = false;
			this.focus.select("path").attr("d", this.focus_path_d);				// 拡大グラフアップデート
//			this.focus.select(".legend.user").attr("transform", this.text_transform).text(this.text_update);
			this.focus_legend.select(".focus-legend-text").text(this.focus_legend_update);
			this.focus.select(".x.axis").call(this.focus_xAxis);				// 拡大x軸アップデート
			this.focus.select(".y.axis").call(this.focus_yAxis); 				// 拡大y軸アップデート
		}
		if(this._draw_context){
			this._draw_context = false;
			this.context.select("path").attr("d", this.context_path_d);			// 全体グラフアップデート
			this.context.select(".x.axis").call(this.context_xAxis);			// 全体x軸アップデート
			this.context_yAxis.tickValues(this.context_y.domain());
			this.context.select(".y.axis").call(this.context_yAxis);			// 全体x軸アップデート
		}
		if(this._draw_depth){
			this._draw_depth = false;
			this.depth.select("path").attr("d", this.depth_path_d);				// 深さグラフアップデート
			this.depth.select(".x.axis").call(this.depth_xAxis);				// 深さx軸アップデート
			this.depth.select(".y.axis").call(this.depth_yAxis); 				// 深さy軸アップデート
			this.depth_area.select("path").attr("d", this.depth_area_d);		// 深さグラフ領域アップデート
		}
	}
}

class Client {
	constructor(hash = "#btc_jpy"){
		this._graph = undefined;
		this.currency_pair = this.getCurrencyPair(hash);
		this.loadHistory();
		this._ws = new WebSocket(this.getWebsocketURL());
		this._ws.onopen = () => {
			console.log('接続しました。');
		};
		this._ws.onerror = (error) => {
			console.error('WebSocket Error ' + error);
		};
		this._ws.onclose = () => {
			console.log('切断しました。');
		};
		this._ws.onmessage = (msg) => {
			const obj = JSON.parse(msg.data);
			this.update(obj);
		};
	}
	dispose(){
		this._ws.close();
		this._graph.dispose();
		this._graph = undefined;
	}
	getCurrencyPair(hash = "#btc_jpy"){
		let cp = hash.slice(1);
		if(currency_pair_list.find(data => data === cp) == undefined){
			cp = currency_pair_list[0];
		}
		return cp
	}
	getWebsocketURL(){
		for(const key in window.dispdata.currency){
			if(window.dispdata.currency.hasOwnProperty(key)){
				window.dispdata.currency[key] = "";
			}
		}
		let wss = streamBaseURL;
		window.dispdata.currency[this.currency_pair] = "active";
		wss += this.currency_pair;
		return wss;
	}
	static getDirection(action){
		return action === "ask" ? "▼" : "▲";
	}
	update(obj){
		const data = {
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
		if(this._graph === undefined){
			this.createGraph(data);
		}
		this.addData(data);
		// vue用
		this.updateView(obj);
	}
	updateView(obj){
		const cp = obj.currency_pair.split("_")
		window.dispdata.currency_pair.first = cp[0];
		window.dispdata.currency_pair.second = cp[1];
		window.dispdata.last_trade.price = obj.last_price.price.toLocaleString();
		window.dispdata.last_trade.action = Client.getDirection(obj.last_price.action);
		window.dispdata.last_trade.type = obj.last_price.action;
		document.title = window.dispdata.last_trade.action
			+ " " + window.dispdata.last_trade.price
			+ " (" + window.dispdata.currency_pair.first + "/" + window.dispdata.currency_pair.second + ") 取引の様子"
			+ " - zaifの取引情報を表示するやつ";
		const tr = [];
		for(let i = obj.trades.length - 1; i >= 0; i--){
			const it = obj.trades[i];
			let dir = "";
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
		window.dispdata.trades = tr;
		window.dispdata.bids = this.analyzeBoard(obj.bids);
		window.dispdata.asks = this.analyzeBoard(obj.asks);
		window.dispdata.date_diff = (Date.parse(obj.timestamp) - Date.now()) / 1000;
	}
	analyzeBoard(data){
		let dep = 0;
		const board = [];
		const len = data.length;
		for(let i = 0; i < len; i++){
			dep += data[i][0] * data[i][1];
			board.push({
				price: data[i][0].toLocaleString(),
				amount: data[i][1],
				depth: (dep | 0).toLocaleString()
			});
		}
		return board;
	}
	setGraphFocusXAxis(sec){
		this._graph.setFocusXAxis(sec);
	}
	createGraph(obj){
		this._graph = new Graph(obj);
	}
	addData(obj){
		const gr = this._graph;
		gr.addContext(obj);
		gr.addDepth(obj);
		gr.draw();
	}
	loadHistory(){
		const url = historyDataURL + this.currency_pair;
		const xhr = new XMLHttpRequest();
		xhr.ontimeout = () => {
			console.error("The request for " + url + " timed out.");
		};
		xhr.onload = (e) => {
			if (xhr.readyState === 4) {
				if (xhr.status === 200) {
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
	addDataHistory(data){
		let ask = undefined;
		let bid = undefined;
		let trade = undefined;
		const l = data.length;
		for(let i = 0; i < l; i++){
			if(data[i].ask !== undefined){
				ask = data[i].ask;
			}
			if(data[i].bid !== undefined){
				bid = data[i].bid;
			}
			if(data[i].trade !== undefined){
				trade = data[i].trade;
			}
			if(ask !== undefined && bid !== undefined && trade !== undefined){
				const obj = {
					Name: this.currency_pair,
					Date: new Date(data[i].ts * 1000),
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
				if(this._graph === undefined){
					this.createGraph(obj);
				}
				this._graph.addContext(obj);
			}
		}
		this._graph.draw();
	}
}

window.dispdata = {
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
	currency: {
		btc_jpy: "",
		xem_jpy: "",
		mona_jpy: "",
		bch_jpy: "",
		eth_jpy: ""
	}
};
window.vm = new Vue({
	el: "#container",
	data: window.dispdata,
	watch: {
		"focus.xaxis.selected": (n, o) => {
			window.cli.setGraphFocusXAxis(n);
		}
	}
});
window.cli = new Client(location.hash);
window.addEventListener("hashchange", (ev) => {
	if(window.cli != null){
		window.cli.dispose();
	}
	window.cli = new Client(location.hash);
}, false);
