var path = require("path");
var webpack = require("webpack");
module.exports = {
	entry: {
		example:"./example",
	},
    externals: {
		"lodash" : "lodash",
		"react" : "react", 
		"react-dom": "react-dom"
	},
	output: {
		path: path.join(__dirname, "packs"),
		filename: "example.js",
		libraryTarget: "umd",
		library: "[name]"
	}
};
