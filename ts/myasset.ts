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

type Display = {
	readonly last_trade: {
		price: string;
		action: Direction;
		type: DirectionEng;
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

const dispdata: Display = {
	last_trade: {
		price: "0",
		action: "▲",
		type: "bid"
	},
	currency_pair: {
		first: "btc",
		second: "jpy"
	},
	date_diff: 0,
	currencys: {
		btc_jpy: {name: "btc/jpy", hash: "/zaif/#btc_jpy", active: ""},
		xem_jpy: {name: "xem/jpy", hash: "/zaif/#xem_jpy", active: ""},
		mona_jpy: {name: "mona/jpy", hash: "/zaif/#mona_jpy", active: ""},
		bch_jpy: {name: "bch/jpy", hash: "/zaif/#bch_jpy", active: ""},
		eth_jpy: {name: "eth/jpy", hash: "/zaif/#eth_jpy", active: ""}
	}
};
const vm = new Vue({
	el: "#container",
	data: dispdata
});