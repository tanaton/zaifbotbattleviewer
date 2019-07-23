const path = require('path');
module.exports = {
	//mode: 'development', 
	mode: 'production',
	entry: {
		bundle: './ts/realtimegraph.ts'
	},  
	output: {
		path: path.join(__dirname,'public_html/js'),
		filename: '[name].js'
	},
	resolve: {
		extensions:['.ts','.js'],
		alias: {
			'vue$': 'vue/dist/vue.esm.js'
		}
	},
	module: {
		rules: [
			{
				// 拡張子が.tsで終わるファイルに対して、TypeScriptコンパイラを適用する
				test:/\.ts$/,loader:'ts-loader'
			}
		]
	}
}
