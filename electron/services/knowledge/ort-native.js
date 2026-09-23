/* eslint-env node */
/**
 * 探测原生 onnxruntime-node 能否加载。
 * 失败时把同名模块指到 onnxruntime-web，让 transformers.js 的静态 import 不再踩原生 DLL。
 *
 * 不解析错误文案：只看 require 成不成功。
 */
'use strict'

const fs = require('fs')
const path = require('path')
const { pathToFileURL, fileURLToPath } = require('url')
const Module = require('module')

/** @typedef {'native' | 'wasm'} OrtBackend */

/** @type {OrtBackend | null} */
let resolvedBackend = null
/** @type {typeof Module._load | null} */
let originalLoad = null
/** @type {Error | null} */
let lastNativeError = null
/** @type {string | null} */
let nativeMainPath = null
/** @type {string | null} */
let webMainPath = null

function resolvePkg(name) {
  try {
    return require.resolve(name)
  } catch {
    return null
  }
}

function tryRequireNativeOrt() {
  require('onnxruntime-node')
}

function toFsPath(request) {
  if (typeof request === 'string' && request.startsWith('file:')) {
    return fileURLToPath(request)
  }
  return request
}

function isOnnxRuntimeNodeRequest(request) {
  if (request === 'onnxruntime-node') return true
  if (!nativeMainPath) return false
  try {
    return path.resolve(toFsPath(request)) === path.resolve(nativeMainPath)
  } catch {
    return request === nativeMainPath
  }
}

/**
 * @returns {OrtBackend}
 */
function ensureOnnxRuntimeBackend() {
  if (resolvedBackend) return resolvedBackend

  try {
    tryRequireNativeOrt()
    resolvedBackend = 'native'
    return resolvedBackend
  } catch (err) {
    lastNativeError = err instanceof Error ? err : new Error(String(err))
    console.warn(
      '[ort-native] onnxruntime-node 加载失败，改用 WASM:',
      lastNativeError.message,
    )
    installOnnxNodeWebAlias()
    resolvedBackend = 'wasm'
    return resolvedBackend
  }
}

function installOnnxNodeWebAlias() {
  if (originalLoad) return

  nativeMainPath = resolvePkg('onnxruntime-node')
  webMainPath = resolvePkg('onnxruntime-web')
  if (!webMainPath) {
    throw new Error('onnxruntime-web 不可用，无法回退 WASM')
  }

  originalLoad = Module._load
  Module._load = function patchedLoad(request, parent, isMain) {
    if (isOnnxRuntimeNodeRequest(request)) {
      return originalLoad.call(this, webMainPath, parent, isMain)
    }
    return originalLoad.call(this, request, parent, isMain)
  }
}

/**
 * transformers 在 Node 里会把 wasmPaths 指到 jsDelivr，Node 不能 import https。
 * 必须在 import('@huggingface/transformers') 之后改回本地文件。
 */
function applyLocalWasmPaths(transformersEnv) {
  const webMain = webMainPath || resolvePkg('onnxruntime-web')
  if (!webMain) {
    throw new Error('onnxruntime-web 不可用，无法设置本地 WASM 路径')
  }
  const distDir = path.dirname(webMain)
  const mjs = path.join(distDir, 'ort-wasm-simd-threaded.asyncify.mjs')
  const wasm = path.join(distDir, 'ort-wasm-simd-threaded.asyncify.wasm')
  if (!fs.existsSync(mjs) || !fs.existsSync(wasm)) {
    throw new Error(`本地 WASM 文件缺失: ${mjs}`)
  }
  const wasmEnv = transformersEnv?.backends?.onnx?.wasm
  if (!wasmEnv) {
    throw new Error('transformers 未提供 WASM 配置，无法改回本地路径')
  }
  wasmEnv.wasmPaths = {
    mjs: pathToFileURL(mjs).href,
    wasm: pathToFileURL(wasm).href,
  }
}

function resetOrtNativeForTest() {
  if (originalLoad) {
    Module._load = originalLoad
    originalLoad = null
  }
  resolvedBackend = null
  lastNativeError = null
  nativeMainPath = null
  webMainPath = null
}

module.exports = {
  applyLocalWasmPaths,
  ensureOnnxRuntimeBackend,
  installOnnxNodeWebAlias,
  isOnnxRuntimeNodeRequest,
  lastNativeError: () => lastNativeError,
  resetOrtNativeForTest,
  tryRequireNativeOrt,
}
