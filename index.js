"use strict";

const path = require("path");
const fs = require("fs");
const asyncLib = require("async");
const webpack = require("webpack");
const DllEntryPlugin = require("webpack/lib/DllEntryPlugin");
const FlagInitialModulesAsUsedPlugin = require("webpack/lib/FlagInitialModulesAsUsedPlugin");

class SystemJSBundlePlugin {
    constructor(options) {
        this.options = options;
    }


    apply(compiler) {
        compiler.plugin("entry-option", (context, entry) => {
            function itemToPlugin(item, name) {
                if(Array.isArray(item))
                    return new DllEntryPlugin(context, item, name);
                else
                    return new DllEntryPlugin(context, [item], name);
            }
            if(typeof entry === "object" && !Array.isArray(entry)) {
                Object.keys(entry).forEach(name => {
                    compiler.apply(itemToPlugin(entry[name], name));
                });
            } else {
                compiler.apply(itemToPlugin(entry, "main"));
            }
            return true;
        });
        compiler.apply(new FlagInitialModulesAsUsedPlugin());

        compiler.plugin("emit", (compilation, callback) => {
            asyncLib.forEach(compilation.chunks, (chunk, callback) => {
                if (!chunk.isInitial()) {
                    callback();
                    return;
                }
                const targetPath = compilation.getPath(this.options.path, {
                    hash: compilation.hash,
                    chunk
                });
                const name = this.options.name && compilation.getPath(this.options.name, {
                    hash: compilation.hash,
                    chunk
                });

                const packagesInfo = {};
                const meta = {};

                const manifest = {
                    name,
                    type: this.options.type,
                    content: chunk.mapModules(module => {
                        let ident = module.identifier();
                        if (ident) {
                            let i = Math.max(ident.lastIndexOf('node_modules'), ident.lastIndexOf('bower_components'));
                            if (i > -1) {
                                let basePath = ident.substr(0, i)
                                let modulesFolder = ident.substr(i, ident.indexOf('/',i) - i);
                                ident = ident.substr(ident.indexOf('/', i)+1);
                                let moduleName = ident.substr(0, ident.indexOf("/"));
                                ident = ident.substr(ident.indexOf("/") + 1);
                                if (moduleName.startsWith("@")) {
                                    moduleName = moduleName + "/" + ident.substr(0, ident.indexOf("/"));
                                    ident = ident.substr(ident.indexOf("/") + 1);
                                }
                                let packageJsonPath = path.join(basePath, modulesFolder, moduleName);
                                if (!packagesInfo[packageJsonPath]) {
                                    if (fs.existsSync(path.join(packageJsonPath,'package.json'))) {
                                        packagesInfo[packageJsonPath] = JSON.parse(fs.readFileSync(path.join(packageJsonPath,'package.json')));
                                    } else if (fs.existsSync(path.join(packageJsonPath,'bower.json'))) {
                                        packagesInfo[packageJsonPath] = JSON.parse(fs.readFileSync(path.join(packageJsonPath,'.bower.json')));
                                    }
                                }
                                ident = moduleName + "@" + packagesInfo[packageJsonPath].version + "/" + ident;
                                return {
                                    ident,
                                    data: {
                                        id: module.id,
                                        meta: module.meta,
                                        exports: Array.isArray(module.providedExports) ? module.providedExports : undefined
                                    }
                                };
                            }
                        }
                    }).filter(Boolean).reduce((obj, item) => {
                        meta[item.ident] = item.data;
                        obj.push(item.ident);
                        return obj;
                    }, [])
                };

                manifest.packagesInfo = {};
                for (let p in packagesInfo) {
                    let info = packagesInfo[p];
                    manifest.packagesInfo[info.name + "@" + info.version] = info;
                }
                let previousSource = compilation.assets[chunk.files[0]].source();
                compilation.assets[chunk.files[0]].source = function() {
                    let source = "\"bundle\";\nvar define = System.amdDefine;\n" + previousSource + "\n";

                    for (let property in meta) {
                        source = source + "System.registerDynamic('"+property+"', ['"+manifest.name+"'], true, function(require,exports,module) { module.exports=require('"+manifest.name+"')("+meta[property].id+"); }); \n"
                    }

                    return source;
                };

                const content = new Buffer(JSON.stringify(manifest), "utf8"); //eslint-disable-line
                compiler.outputFileSystem.mkdirp(path.dirname(targetPath), err => {
                    if (err) return callback(err);
                    compiler.outputFileSystem.writeFile(targetPath, content, callback);
                });
            }, callback);
        });
    }
}

module.exports = SystemJSBundlePlugin;
