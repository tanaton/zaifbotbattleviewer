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

const streamBaseURL = "wss://ws.zaif.jp/stream?currency_pair=";
const historyDataURL = "/api/zaif/1/oldstream/";
const currency_pair_list: readonly CurrencyPair[] = ["btc_jpy", "xem_jpy", "mona_jpy", "bch_jpy", "eth_jpy"];

type Box = {
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
    readonly left: number;
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
    readonly price: number;
    readonly depth: number;
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