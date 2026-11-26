package com.gpe.pdf

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.provider.DocumentsContract
import android.provider.OpenableColumns
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.util.Base64
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.addCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.FileProvider
import androidx.core.content.IntentCompat
import androidx.core.view.WindowCompat
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger

/** PdfEditor on the phone: the www/ app in a WebView, plus what a web page can't do by itself
 *  (open and save files on the phone, share, read aloud). The page talks to it through window.Android (www/ui.js). */
class MainActivity : ComponentActivity() {
    private lateinit var web: WebView
    private var pageReady = false
    private val pending = mutableListOf<String>()          // calls into the page made before it finished loading

    private val files = ConcurrentHashMap<String, Uri>()   // token -> file the user opened
    private val writes = ConcurrentHashMap<String, File>()  // handle -> temp file being written by the page
    private val seq = AtomicInteger(0)

    private var pickMode = ""
    private var saveJob: Triple<String, String, String>? = null   // handle, name, callback

    private var tts: TextToSpeech? = null
    private var ttsReady = false
    private var ttsFailed = false
    private var ttsPending: Triple<String, Float, String>? = null

    private val openDoc = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
        val list = mutableListOf<Uri>()
        val d = r.data
        if (r.resultCode == RESULT_OK && d != null) {
            d.clipData?.let { c -> for (i in 0 until c.itemCount) c.getItemAt(i).uri?.let { list.add(it) } }
            if (list.isEmpty()) d.data?.let { list.add(it) }
        }
        val json = JSONArray()
        for (u in list) {
            var write = false
            try { contentResolver.takePersistableUriPermission(u, Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION); write = true }
            catch (_: Exception) { try { contentResolver.takePersistableUriPermission(u, Intent.FLAG_GRANT_READ_URI_PERMISSION) } catch (_: Exception) { } }
            json.put(entry(u, write && writable(u)))
        }
        js("GPE.onFilesOpened(" + json + "," + JSONObject.quote(pickMode) + ")")
    }

    private val createDoc = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
        val job = saveJob ?: return@registerForActivityResult
        saveJob = null
        val (h, name, cb) = job
        val u = if (r.resultCode == RESULT_OK) r.data?.data else null
        val tmp = writes.remove(h)
        var ok = false
        var shown = name
        if (u != null && tmp != null) {
            ok = copyTo(tmp, u)
            shown = displayName(u) ?: name
        }
        tmp?.delete()
        js("GPE.onSaved(" + ok + "," + JSONObject.quote(shown) + "," + JSONObject.quote(cb) + ")")
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, true)
        web = WebView(this)
        setContentView(web)
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            @Suppress("DEPRECATION")
            databaseEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            textZoom = 100
            mediaPlaybackRequiresUserGesture = false
            setSupportMultipleWindows(false)
        }
        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? = serve(request.url)
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (request.url.host == HOST) return false
                openExternal(request.url); return true
            }
            override fun onPageFinished(view: WebView, url: String) {
                web.postDelayed({
                    pageReady = true
                    val list = pending.toList(); pending.clear()
                    list.forEach { web.evaluateJavascript(it, null) }
                }, 400)
            }
        }
        web.webChromeClient = WebChromeClient()
        web.setDownloadListener { url, _, _, _, _ -> openExternal(Uri.parse(url)) }
        web.addJavascriptInterface(Bridge(), "Android")

        onBackPressedDispatcher.addCallback(this) {
            web.evaluateJavascript("(window.GPE&&GPE.back&&GPE.back())?'1':'0'") { r ->
                if (r?.contains("1") != true) { isEnabled = false; onBackPressedDispatcher.onBackPressed(); isEnabled = true }
            }
        }

        File(cacheDir, "out").deleteRecursively()
        web.loadUrl("https://$HOST/assets/www/index.html")
        handleIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIntent(intent)
    }

    override fun onDestroy() {
        tts?.shutdown()
        web.destroy()
        super.onDestroy()
    }

    // ------------------------------------------------------------------ the app's own files, and the files the user opened
    private fun mimeOf(path: String): String = when (path.substringAfterLast('.', "").lowercase()) {
        "html", "htm" -> "text/html"
        "js", "mjs" -> "text/javascript"
        "css" -> "text/css"
        "json" -> "application/json"
        "wasm" -> "application/wasm"
        "png" -> "image/png"
        "jpg", "jpeg" -> "image/jpeg"
        "svg" -> "image/svg+xml"
        "woff2" -> "font/woff2"
        "woff" -> "font/woff"
        "ttf" -> "font/ttf"
        "gz" -> "application/gzip"
        "txt" -> "text/plain"
        else -> "application/octet-stream"
    }

    private fun serve(u: Uri): WebResourceResponse? {
        if (u.host != HOST) return null
        val path = u.path ?: return null
        val headers = mapOf("Access-Control-Allow-Origin" to "*", "Cache-Control" to "no-cache")
        return try {
            when {
                path.startsWith("/assets/") -> {
                    val name = path.removePrefix("/assets/")
                    val mime = mimeOf(name)
                    val text = mime.startsWith("text/") || mime == "application/json"
                    WebResourceResponse(mime, if (text) "utf-8" else null, 200, "OK", headers, assets.open(name))
                }
                path.startsWith("/file/") -> {
                    val uri = files[path.removePrefix("/file/")] ?: return WebResourceResponse("text/plain", "utf-8", 404, "Not Found", headers, "".byteInputStream())
                    val s = contentResolver.openInputStream(uri) ?: return WebResourceResponse("text/plain", "utf-8", 404, "Not Found", headers, "".byteInputStream())
                    WebResourceResponse(contentResolver.getType(uri) ?: "application/octet-stream", null, 200, "OK", headers, s)
                }
                else -> null
            }
        } catch (_: Exception) {
            WebResourceResponse("text/plain", "utf-8", 404, "Not Found", headers, "".byteInputStream())
        }
    }

    private fun displayName(u: Uri): String? = try {
        contentResolver.query(u, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c -> if (c.moveToFirst()) c.getString(0) else null }
    } catch (_: Exception) { null }

    private fun sizeOf(u: Uri): Long = try {
        contentResolver.query(u, arrayOf(OpenableColumns.SIZE), null, null, null)?.use { c -> if (c.moveToFirst() && !c.isNull(0)) c.getLong(0) else -1L } ?: -1L
    } catch (_: Exception) { -1L }

    /** Whether the file can be overwritten in place ("Save" instead of "Save as"). */
    private fun writable(u: Uri): Boolean {
        if (!DocumentsContract.isDocumentUri(this, u)) return false
        return try {
            contentResolver.query(u, arrayOf(DocumentsContract.Document.COLUMN_FLAGS), null, null, null)?.use { c ->
                c.moveToFirst() && (c.getInt(0) and DocumentsContract.Document.FLAG_SUPPORTS_WRITE) != 0
            } ?: false
        } catch (_: Exception) { false }
    }

    private fun entry(u: Uri, canSave: Boolean): JSONObject {
        val token = "f" + seq.incrementAndGet()
        files[token] = u
        val name = displayName(u) ?: u.lastPathSegment?.substringAfterLast('/') ?: "document.pdf"
        return JSONObject().put("name", name).put("size", sizeOf(u)).put("mime", contentResolver.getType(u) ?: "")
            .put("url", "https://$HOST/file/$token").put("token", token).put("canSave", canSave)
    }

    private fun copyTo(tmp: File, u: Uri): Boolean {
        for (mode in listOf("wt", "w", "rwt")) {
            try {
                val out = contentResolver.openOutputStream(u, mode) ?: continue
                out.use { o -> tmp.inputStream().use { it.copyTo(o, 1 shl 16) } }
                return true
            } catch (_: Exception) { }
        }
        return false
    }

    /** A finished file in the app's cache, under its real name, for sharing or opening in another app. */
    private fun exportCopy(h: String, name: String): Uri? {
        val tmp = writes.remove(h) ?: return null
        val dir = File(cacheDir, "out/" + seq.incrementAndGet()).apply { mkdirs() }
        val safe = name.replace(Regex("[\\\\/:*?\"<>|]"), "_").ifBlank { "document.pdf" }
        val f = File(dir, safe)
        if (!tmp.renameTo(f)) { tmp.copyTo(f, true); tmp.delete() }
        return FileProvider.getUriForFile(this, "$packageName.files", f)
    }

    // ------------------------------------------------------------------ files handed to the app (Open with, Share)
    private fun handleIntent(i: Intent?) {
        if (i == null) return
        val list = mutableListOf<Uri>()
        when (i.action) {
            Intent.ACTION_VIEW -> i.data?.let { list.add(it) }
            Intent.ACTION_SEND -> IntentCompat.getParcelableExtra(i, Intent.EXTRA_STREAM, Uri::class.java)?.let { list.add(it) }
            Intent.ACTION_SEND_MULTIPLE -> IntentCompat.getParcelableArrayListExtra(i, Intent.EXTRA_STREAM, Uri::class.java)?.let { list.addAll(it) }
        }
        if (list.isEmpty()) return
        val canWrite = i.flags and Intent.FLAG_GRANT_WRITE_URI_PERMISSION != 0
        val json = JSONArray()
        for (u in list) json.put(entry(u, i.action == Intent.ACTION_VIEW && canWrite && writable(u)))
        js("GPE.onFilesOpened(" + json + ",\"open\")")
        i.action = Intent.ACTION_MAIN
    }

    // ------------------------------------------------------------------ helpers
    private fun js(code: String) = runOnUiThread {
        if (pageReady) web.evaluateJavascript(code, null) else pending.add(code)
    }

    private fun toast(t: String) = runOnUiThread { Toast.makeText(this, t, Toast.LENGTH_LONG).show() }

    private fun openExternal(u: Uri) {
        try { startActivity(Intent(Intent.ACTION_VIEW, u).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } catch (_: Exception) { toast("No app found to open the link.") }
    }

    private fun setBars(hex: String) {
        val c = try { Color.parseColor(hex) } catch (_: Exception) { return }
        @Suppress("DEPRECATION")
        run { window.statusBarColor = c; window.navigationBarColor = c }
        val light = (0.299 * Color.red(c) + 0.587 * Color.green(c) + 0.114 * Color.blue(c)) > 150
        WindowCompat.getInsetsController(window, window.decorView).apply {
            isAppearanceLightStatusBars = light
            isAppearanceLightNavigationBars = light
        }
        window.decorView.setBackgroundColor(c)
    }

    // ------------------------------------------------------------------ read aloud
    private fun speakNow(text: String, rate: Float, lang: String) {
        val t = tts ?: return
        try { t.language = Locale.forLanguageTag(lang) } catch (_: Exception) { }
        t.setSpeechRate(rate)
        t.speak(text, TextToSpeech.QUEUE_FLUSH, null, "u" + seq.incrementAndGet())
    }

    private fun ensureTts() {
        if (tts != null) return
        tts = TextToSpeech(applicationContext) { status ->
            runOnUiThread {
                if (status == TextToSpeech.SUCCESS) {
                    ttsReady = true
                    tts?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                        override fun onStart(id: String?) {}
                        override fun onDone(id: String?) { js("window.GPE&&GPE.onSpeakDone&&GPE.onSpeakDone()") }
                        @Deprecated("old API") override fun onError(id: String?) { js("window.GPE&&GPE.onSpeakDone&&GPE.onSpeakDone()") }
                    })
                    ttsPending?.let { speakNow(it.first, it.second, it.third) }
                } else {
                    ttsFailed = true
                    if (ttsPending != null) toast("Text-to-speech is not available on this phone.")
                }
                ttsPending = null
            }
        }
    }

    // ------------------------------------------------------------------ the bridge (window.Android, see www/ui.js)
    inner class Bridge {
        @JavascriptInterface fun openFiles(mimes: String?, multiple: Boolean, mode: String?) {
            runOnUiThread {
                pickMode = mode ?: ""
                val types = (mimes ?: "*/*").split(",").map { it.trim() }.filter { it.isNotEmpty() }
                val i = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE)
                    type = if (types.size == 1) types[0] else "*/*"
                    if (types.size > 1) putExtra(Intent.EXTRA_MIME_TYPES, types.toTypedArray())
                    putExtra(Intent.EXTRA_ALLOW_MULTIPLE, multiple)
                }
                try { openDoc.launch(i) } catch (_: ActivityNotFoundException) { js("GPE.onFilesOpened([]," + JSONObject.quote(pickMode) + ")"); toast("No file manager found.") }
            }
        }

        @JavascriptInterface fun releaseFile(token: String?) { if (token != null) files.remove(token) }

        @JavascriptInterface fun beginWrite(): String? = try {
            val dir = File(cacheDir, "write").apply { mkdirs() }
            val h = "w" + seq.incrementAndGet()
            val f = File(dir, h)
            f.delete()
            writes[h] = f
            h
        } catch (_: Exception) { null }

        @JavascriptInterface fun writeChunk(h: String?, b64: String?): Boolean {
            val f = writes[h ?: return false] ?: return false
            return try { FileOutputStream(f, true).use { it.write(Base64.decode(b64 ?: "", Base64.DEFAULT)) }; true } catch (_: Exception) { false }
        }

        @JavascriptInterface fun saveOver(h: String?, token: String?): Boolean {
            val tmp = writes.remove(h ?: return false) ?: return false
            val u = files[token ?: ""] ?: run { tmp.delete(); return false }
            val ok = copyTo(tmp, u)
            tmp.delete()
            return ok
        }

        @JavascriptInterface fun saveAs(h: String?, name: String?, mime: String?, cb: String?) {
            runOnUiThread {
                saveJob = Triple(h ?: "", name ?: "document.pdf", cb ?: "")
                val i = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE)
                    type = mime?.ifBlank { null } ?: "application/octet-stream"
                    putExtra(Intent.EXTRA_TITLE, name ?: "document.pdf")
                }
                try { createDoc.launch(i) } catch (_: ActivityNotFoundException) {
                    saveJob = null; writes.remove(h ?: "")?.delete()
                    js("GPE.onSaved(false,null," + JSONObject.quote(cb ?: "") + ")")
                }
            }
        }

        @JavascriptInterface fun share(h: String?, name: String?, mime: String?) {
            runOnUiThread {
                val u = exportCopy(h ?: return@runOnUiThread, name ?: "document.pdf") ?: return@runOnUiThread
                val send = Intent(Intent.ACTION_SEND).setType(mime ?: "application/octet-stream").putExtra(Intent.EXTRA_STREAM, u).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                try { startActivity(Intent.createChooser(send, "Share")) } catch (_: Exception) { toast("No app to share with.") }
            }
        }

        @JavascriptInterface fun open(h: String?, name: String?, mime: String?) {
            runOnUiThread {
                val u = exportCopy(h ?: return@runOnUiThread, name ?: "document") ?: return@runOnUiThread
                val i = Intent(Intent.ACTION_VIEW).setDataAndType(u, mime ?: "*/*").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                try { startActivity(i) } catch (_: ActivityNotFoundException) { toast("No app on the phone can open this file.") }
            }
        }

        @JavascriptInterface fun openUrl(url: String?) { if (url != null) runOnUiThread { openExternal(Uri.parse(url)) } }

        @JavascriptInterface fun setBarColor(hex: String?) { if (hex != null) runOnUiThread { setBars(hex) } }

        @JavascriptInterface fun keepScreenOn(on: Boolean) {
            runOnUiThread { if (on) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) }
        }

        @JavascriptInterface fun speak(text: String?, rate: Double, lang: String?): Boolean {
            if (ttsFailed) return false
            val t = text ?: return false
            runOnUiThread {
                if (ttsReady) speakNow(t, rate.toFloat(), lang ?: "en-US")
                else { ttsPending = Triple(t, rate.toFloat(), lang ?: "en-US"); ensureTts() }
            }
            return true
        }

        @JavascriptInterface fun stopSpeaking() { runOnUiThread { ttsPending = null; tts?.stop() } }
    }

    companion object {
        private const val HOST = "appassets.androidplatform.net"
    }
}
