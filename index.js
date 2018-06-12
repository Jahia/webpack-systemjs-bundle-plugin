"use strict";

const path = require("path");
const fs = require("fs");
const asyncLib = require("async");
const RawSource = require("webpack-sources").RawSource;

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
        compiler.hooks.compilation.tap('systemjs-bundle-plugin', (compilation) => {
            compilation.hooks.beforeChunkAssets.tap('systemjs-bundle-plugin', () => {
                compilation.entries.forEach(entry => {
                    entry.source = (dependencyTemplates, outputOptions) => {
                        const str = [];
                        str.push("module.exports = {\n");

                        entry.dependencies.forEach(function(dep, idx) {
                            if (dep.module) {
                                str.push(" '");
                                str.push(dep.module.rawRequest);
                                str.push("' : ");
                                str.push("__webpack_require__(");
                                if (outputOptions.pathinfo)
                                    str.push(`/*! ${dep.request} */`);
                                str.push(`${JSON.stringify(dep.module.id)}`);
                                str.push(")");
                            } else {
                                str.push("(function webpackMissingModule() { throw new Error(");
                                str.push(JSON.stringify(`Cannot find module "${dep.request}"`));
                                str.push("); }())");
                            }
                            if (idx !== this.dependencies.length - 1)
                                str.push(",");
                            str.push("\n");

                        }, entry);
                        str.push("}\n");
                        return new RawSource(str.join(""));
                    }
                })
            });
        });

        compiler.hooks.emit.tapAsync('systemjs-bundle-plugin', (compilation, callback) => {

            // Iterate on all configuration entries
            asyncLib.forEach(compilation.entries, (entry, callback) => {

                // Use main chunk to get the output file name
                const chunk = entry.getChunks()[0];

                const name = this.options.name && compilation.getPath(this.options.name, {
                    hash: compilation.hash,
                    chunk
                });
                const targetPath = compilation.getPath(this.options.path, {
                    hash: compilation.hash,
                    chunk
                });

                const packagesInfo = {};
                const meta = {};
                const mainEntriesContent = [];

                // Iterate on each dependency of the current entry to get all entry points
                entry.dependencies.forEach(dependency => {
                    let module = dependency.module;
                    let ident = module.userRequest;
                    if (ident) {
                        let descriptor = this.findDescriptor(ident);
                        if (descriptor) {
                            if (!packagesInfo[descriptor]) {
                                packagesInfo[descriptor] = JSON.parse(fs.readFileSync(descriptor));
                            }
                            ident = ident.substr(descriptor.lastIndexOf('/') + 1);
                            ident = packagesInfo[descriptor].name + "@" + packagesInfo[descriptor].version + "/" + ident;

                            meta[ident] = {
                                id: module.rawRequest,
                                meta: module.buildMeta,
                                exports: Array.isArray(module.providedExports) ? module.providedExports : undefined
                            };

                            mainEntriesContent.push(ident);
                        }
                    }
                });

                const manifest = {
                    name,
                    type: this.options.type,
                    content: mainEntriesContent
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
                        source = source + "System.registerDynamic('"+property+"', ['"+manifest.name+"'], true, function(require,exports,module) { module.exports=require('"+manifest.name+"')['"+meta[property].id+"']; }); \n"
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
