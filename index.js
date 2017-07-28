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

                const manifest = {
                    name,
                    type: this.options.type,
                    content: chunk.mapModules(module => {
                        if (module.libIdent) {
                            let ident = module.libIdent({
                                context: "node_modules"
                            });
                            if (ident && ident.startsWith('./')) {
                                ident = ident.substr(2);
                                let moduleName = ident.substr(0, ident.indexOf("/"));
                                ident = ident.substr( ident.indexOf("/") + 1);
                                if (moduleName.startsWith("@")) {
                                    moduleName = moduleName + "/" + ident.substr(0, ident.indexOf("/"));
                                    ident = ident.substr(ident.indexOf("/") + 1);
                                }
                                let packageJsonPath = path.join(module.identifier().substr(0,module.identifier().lastIndexOf('node_modules')), "node_modules", moduleName, "package.json");
                                if (!packagesInfo[packageJsonPath]) {
                                    packagesInfo[packageJsonPath] =  JSON.parse(fs.readFileSync(packageJsonPath));
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
                        obj[item.ident] = item.data;
                        return obj;
                    }, Object.create(null))
                };
                manifest.packagesInfo = {};
                for (let p in packagesInfo) {
                    let info = packagesInfo[p];
                    manifest.packagesInfo[info.name + "@" + info.version] = info;
                }
                let previousSource = compilation.assets[chunk.files[0]].source();
                compilation.assets[chunk.files[0]].source = function() {
                    let source = previousSource + "\n";

                    for (let property in manifest.content) {
                        source = source + "System.registerDynamic('"+property+"', ['"+manifest.name+"'], true, function(require,exports,module) { module.exports=require('"+manifest.name+"')("+manifest.content[property].id+"); }); \n"
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
