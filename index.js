"use strict";

const path = require("path");
const fs = require("fs");
const asyncLib = require("async");
const webpack = require("webpack");
const DllEntryPlugin = require("webpack/lib/DllEntryPlugin");
const FlagInitialModulesAsUsedPlugin = require("webpack/lib/FlagInitialModulesAsUsedPlugin");

const descriptorNames = ['package.json', '.bower.json'];

class SystemJSBundlePlugin {
    constructor(options) {
        this.options = options;
    }

    findDescriptor(currentFullPath) {
        function splitPath(path) {
            var parts = path.split(/(\/|\\)/);
            if (!parts.length) return parts;

            // when path starts with a slash, the first part is empty string
            return !parts[0].length ? parts.slice(1) : parts;
        }

        function testDir(parts) {
            if (parts.length === 0) return null;

            var p = parts.join('');
            for (var i = 0; i < descriptorNames.length; i++) {
                if (fs.existsSync(path.join(p, descriptorNames[i]))) {
                    return path.join(p, descriptorNames[i]);
                }
            }
            return testDir(parts.slice(0, -1));
        }

        return testDir(splitPath(currentFullPath));
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
                        let ident = module.userRequest;
                        if (ident) {
                            let descriptor = this.findDescriptor(ident);
                            if (descriptor) {
                                if (!packagesInfo[descriptor]) {
                                    packagesInfo[descriptor] = JSON.parse(fs.readFileSync(descriptor));
                                }
                                ident = ident.substr(descriptor.lastIndexOf('/')+1);
                                ident = packagesInfo[descriptor].name + "@" + packagesInfo[descriptor].version + "/" + ident;
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
                    let source = "\"bundle\";var define = System.amdDefine;" + previousSource + "\n";

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
