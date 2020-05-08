// メモリを再利用するjsonパーサを用意したがメモリ使用量に目立った変化は見られなかったため封印
// 参考：http://sifue.hatenablog.com/entry/20120218/1329588477

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

export class ZaifJSON {
    private at: number;     // 現在の文字のインデックス値
    private ch: string;     // 現在の文字
    private escapee: { [key in string]: string } = {
        '"': '"',
        '\\': '\\',
        '/': '/',
        b: 'b',
        f: '\f',
        n: '\n',
        r: '\r',
        t: '\t'
    };
    private text: string;

    constructor() {
        this.text = "";
        this.at = 0;
        this.ch = ' ';
    }
    private init(source: string) {
        this.text = source; // sourceをtextに移動
        this.at = 0;
        this.ch = ' ';
    }
    private error(m: string) {
        throw {
            name: 'SyntaxError',
            message: m,
            at: this.at,
            text: this.text
        };
    }
    private next(c?: string): string {
        // 一文字次に進める関数
        if (c && c !== this.ch) {
            this.error("Expected '" + c + "' instead of '" + this.ch + "'");
        }
        // 次の文字を取得します。もしそれ以上がなかったら、
        // 空文字を返します
        this.ch = this.text.charAt(this.at);
        this.at += 1;
        return this.ch;
    }
    private white(): void {
        // ホワイトスペースを無視する関数
        while (this.ch && this.ch <= ' ') {
            this.next();
        }
    }
    private number(): number {
        let string: string = '';
        // もしマイナスが来たら、マイナスをstringに取りおいて次へ
        if (this.ch === '-') {
            string += '-';
            this.ch = this.next('-');
        }
        // 0〜9までの間の文字コードならば、stringに連結させては次へ
        while (this.ch >= '0' && this.ch <= '9') {
            string += this.ch;
            this.ch = this.next();
        }
        // .が来たら.をstringに結合して、次があればstringに数値を結合します
        if (this.ch === '.') {
            string += '.';
            while (this.next() && this.ch >= '0' && this.ch <= '9') {
                string += this.ch;
            }
        }
        // eかEが来たら、+か-を処理後、0〜9までを処理します
        if (this.ch === 'e' || this.ch === 'E') {
            string += this.ch;
            this.ch = this.next();
            if (this.ch === '-' || this.ch === '+') {
                string += this.ch;
                this.ch = this.next();
            }
            while (this.ch >= '0' && this.ch <= '9') {
                string += this.ch;
                this.ch = this.next();
            }
        }

        // 最後にstringを結合、数値変換したものをnumberに代入し、チェックして返します
        const number = +string;
        if (isNaN(number)) {
            this.error("Bad number");
        }
        return number;
    }
    private string(): string {
        let string: string = '';

        if (this.ch === '"') {
            while (this.next()) {
                if (this.ch === '"') {
                    this.next();
                    return string;
                } else if (this.ch === '\\') {
                    this.next();
                    if (this.ch === 'u') {
                        let uffff = 0;
                        for (let i = 0; i < 4; i += 1) {
                            const hex = parseInt(this.next(), 16);
                            if (!isFinite(hex)) {
                                break;
                            }
                            uffff = uffff * 16 + hex;
                        }
                        string += String.fromCharCode(uffff);
                    } else if (typeof this.escapee[this.ch] === 'string') {
                        string += this.escapee[this.ch];
                    } else {
                        break;
                    }
                } else {
                    string += this.ch;
                }
            }
        }
        this.error("Bad string");
        return "";
    };
    private word(): boolean | null {
        // true, false, nullを処理する関数
        switch (this.ch) {
            case 't':
                this.next('t');
                this.next('r');
                this.next('u');
                this.next('e');
                return true;
            case 'f':
                this.next('f');
                this.next('a');
                this.next('l');
                this.next('s');
                this.next('e');
                return false;
            case 'n':
                this.next('n');
                this.next('u');
                this.next('l');
                this.next('l');
                return null;
        }
        this.error("Unexpected '" + this.ch + "'");
        return null;
    }

    private zaiflastprice(lastprice: ZaifLastPrice): void {
        if (this.ch === '{') {
            this.ch = this.next('{');
            this.white();
            if (this.ch === '}') {
                this.ch = this.next('}');
                return;   // 空のオブジェクト 
            }
            while (this.ch) {
                const key = this.string();   // keyはstring関数の値を入れる
                this.white();
                this.ch = this.next(':');
                this.white();
                switch (key) {
                    case "price":
                        lastprice.price = this.number();
                        break;
                    case "action":
                        {
                            const dir = this.string();
                            if (isDirectionEng(dir)) {
                                lastprice.action = dir;
                            }
                        }
                        break;
                    default:
                        // 他はスルーする
                        this.value();
                        break;
                }
                this.white();
                if (this.ch === '}') {
                    this.ch = this.next('}');
                    return;
                }
                this.ch = this.next(',');
                this.white();
            }
        }
        this.error("Unexpected '" + this.ch + "'");
    }

    private zaiftrade(trade: ZaifTrade): void {
        if (this.ch === '{') {
            this.ch = this.next('{');
            this.white();
            if (this.ch === '}') {
                this.ch = this.next('}');
                return;
            }
            while (this.ch) {
                const key = this.string();   // keyはstring関数の値を入れる
                this.white();
                this.ch = this.next(':');
                this.white();
                switch (key) {
                    case "tid":
                        trade.tid = this.number();
                        break;
                    case "trade_type":
                        {
                            const dir = this.string();
                            if (isDirectionEng(dir)) {
                                trade.trade_type = dir;
                            }
                        }
                        break;
                    case "price":
                        trade.price = this.number();
                        break;
                    case "amount":
                        trade.amount = this.number();
                        break;
                    case "date":
                        trade.date = this.number();
                        break;
                    default:
                        // 他はスルーする
                        this.value();
                        break;
                }
                this.white();
                if (this.ch === '}') {
                    this.ch = this.next('}');
                    return;
                }
                this.ch = this.next(',');
                this.white();
            }
        }
        this.error("Unexpected '" + this.ch + "'");
    }
    private zaiftradearray(array: ZaifTrade[]): void {
        if (this.ch === '[') {
            this.ch = this.next('[');
            this.white();
            if (this.ch === ']') {
                this.ch = this.next(']');
                return;
            }
            let index = 0;
            while (this.ch) { //値があるなら、value関数の実行結果を配列に入れる
                if (array[index] === undefined) {
                    array[index] = {
                        tid: 0,
                        trade_type: "ask",
                        price: 0,
                        amount: 0,
                        date: 0
                    };
                }
                this.zaiftrade(array[index]);
                index++;
                this.white();
                if (this.ch === ']') {
                    this.next(']');
                    array.length = index;
                    return;
                }
                this.ch = this.next(',');
                this.white();
            }
        }
        this.error("Unexpected '" + this.ch + "'");
    }

    private zaifboard(board: ZaifBoard): void {
        if (this.ch === '[') {
            this.ch = this.next('[');
            this.white();
            if (this.ch === ']') {
                this.ch = this.next(']');
                return;
            }
            let index = 0;
            while (this.ch) { //値があるなら、value関数の実行結果を配列に入れる
                board[index++] = this.number();
                this.white();
                if (this.ch === ']' || index >= 2) {
                    // 2つを超える値は入っていないものとする
                    this.next(']');
                    return;
                }
                this.ch = this.next(',');
                this.white();
            }
        }
        this.error("Unexpected '" + this.ch + "'");
    }
    private zaifboardarray(array: ZaifBoard[]): void {
        if (this.ch === '[') {
            this.ch = this.next('[');
            this.white();
            if (this.ch === ']') {
                this.ch = this.next(']');
                return;
            }
            let index = 0;
            while (this.ch) { //値があるなら、value関数の実行結果を配列に入れる
                if (array[index] === undefined) {
                    array[index] = [0, 0];
                }
                this.zaifboard(array[index]);
                index++;
                this.white();
                if (this.ch === ']') {
                    this.next(']');
                    return;
                }
                this.ch = this.next(',');
                this.white();
            }
        }
        this.error("Unexpected '" + this.ch + "'");
    }

    private zaifstream(stream: ZaifStream): void {
        if (this.ch === '{') {
            this.ch = this.next('{');
            this.white();
            if (this.ch === '}') {
                this.ch = this.next('}');
                return;
            }
            while (this.ch) {
                const key = this.string();   // keyはstring関数の値を入れる
                this.white();
                this.ch = this.next(':');
                this.white();
                switch (key) {
                    case "currency_pair":
                        {
                            const cp = this.string();
                            if (isCurrencyPair(cp)) {
                                stream.currency_pair = cp;
                            }
                        }
                        break;
                    case "timestamp":
                        stream.timestamp = this.string();
                        break;
                    case "asks":
                        this.zaifboardarray(stream.asks);
                        break;
                    case "bids":
                        this.zaifboardarray(stream.bids);
                        break;
                    case "trades":
                        this.zaiftradearray(stream.trades);
                        break;
                    case "last_price":
                        this.zaiflastprice(stream.last_price);
                        break;
                    default:
                        // 他はスルーする
                        this.value();
                        break;
                }
                this.white();
                if (this.ch === '}') {
                    this.ch = this.next('}');
                    return;
                }
                this.ch = this.next(',');
                this.white();
            }
        }
        this.error("Unexpected '" + this.ch + "'");
    }

    private object(): void {
        // オブジェクトを解析する関数
        if (this.ch === '{') {
            this.ch = this.next('{');
            this.white();
            if (this.ch === '}') {
                this.ch = this.next('}');
                return;   // 何も返さない
            }
            while (this.ch) {
                this.string();   // keyを読み捨てる
                this.white();
                this.ch = this.next(':');
                this.value(); // 読み捨てる
                this.white();
                if (this.ch === '}') {
                    this.ch = this.next('}');
                    return; // 何も返さない
                }
                this.ch = this.next(',');
                this.white();
            }
        }
        this.error("Unexpected '" + this.ch + "'");
    }
    private array(): void {
        if (this.ch === '[') {
            this.ch = this.next('[');
            this.white();
            if (this.ch === ']') {
                this.ch = this.next(']');
                return;   // 読み捨てる
            }
            while (this.ch) {
                this.value();    // 読み捨てる
                this.white();
                if (this.ch === ']') {
                    this.next(']');
                    return;     // 読み捨てる
                }
                this.ch = this.next(',');
                this.white();
            }
        }
        this.error("Unexpected '" + this.ch + "'");
    }
    private value(): void {
        // JSONの値を解析する関数
        this.white();
        switch (this.ch) {
            case '{':
                this.object();
                return;
            case '[':
                this.array();
                return;
            case '"':
                this.string();
                return;
            case '-':
                this.number();
                return;
            default:
                if (this.ch >= '0' && this.ch <= '9') {
                    this.number();
                } else {
                    this.word();
                }
                return;
        }
    };

    public parse(stream: ZaifStream, source: string): void {
        this.init(source);
        this.white();
        this.zaifstream(stream);
        this.white();
        if (this.ch) { // ここで文字列の最後に到達しているはず
            this.error("Syntax error");
        }
    }
}