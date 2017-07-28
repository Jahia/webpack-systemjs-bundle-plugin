var path = require("path");
var webpack = require("webpack");
var SystemJSPlugin = require('../index.js');


module.exports = {
	resolve: {
		extensions: [".js", ".jsx"]
	},
	entry: {
		vendors: ["lodash", "react", "react-dom"],
		lodash: "lodash"
	},
	externals: {
	},
	output: {
		path: path.join(__dirname, "packs"),
		filename: "[name].bundle.js",
		libraryTarget: "amd",
		library: "[name]_[hash]"
	},
	plugins: [
		new SystemJSPlugin({
            path: path.join(__dirname, "packs", "[name].bundle.config.json"),
            name: "[name]_[hash]"
		})
	]
};
