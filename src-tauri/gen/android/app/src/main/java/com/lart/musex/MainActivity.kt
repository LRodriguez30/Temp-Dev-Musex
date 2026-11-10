package com.lart.musex

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.Settings
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {

    private var webView: WebView? = null

    @Volatile private var safeTopDp = 0f
    @Volatile private var safeBottomDp = 0f

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)

        // Fondo negro y iconos claros en la barra de estado.
        window.decorView.setBackgroundColor(Color.BLACK)
        WindowCompat.getInsetsController(window, window.decorView)
            .isAppearanceLightStatusBars = false

        // Guarda los márgenes de las barras del sistema (en dp) para
        // que la interfaz los use como --safe-top / --safe-bottom.
        ViewCompat.setOnApplyWindowInsetsListener(
            findViewById(android.R.id.content)
        ) { _, insets ->
            val bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or
                    WindowInsetsCompat.Type.displayCutout()
            )
            val density = resources.displayMetrics.density
            safeTopDp = bars.top / density
            safeBottomDp = bars.bottom / density
            insets
        }

        // Android 13+: sin este permiso la notificación del reproductor no se muestra.
        if (Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
        }
    }

    // Hook de Tauri/wry: se llama cuando el WebView ya existe.
    override fun onWebViewCreate(webView: WebView) {
        this.webView = webView

        webView.settings.mediaPlaybackRequiresUserGesture = false
        webView.addJavascriptInterface(MusexBridge(), "MusexAndroid")

        // Botones de la notificación / pantalla de bloqueo -> JavaScript
        MusexPlaybackService.setCommandHandler { command ->
            runOnUiThread {
                // Si el WebView ya no es el de esta Activity, se descarta.
                if (this.webView === webView) {
                    webView.evaluateJavascript(
                        "window.__musexMediaCommand && window.__musexMediaCommand('$command')",
                        null
                    )
                }
            }
        }
    }

    override fun onDestroy() {
        // El handler apunta a esta Activity y a su WebView: si se queda
        // registrado tras destruirse, los botones de la notificación
        // dejan de hacer nada sin avisar.
        MusexPlaybackService.setCommandHandler(null)
        webView = null

        if (isFinishing) {
            MusexPlaybackService.isPlaying = false
            MusexPlaybackService.autoPickActive = false
            stopService(Intent(this, MusexPlaybackService::class.java))
        }

        super.onDestroy()
    }

    // Al apagar la pantalla / cambiar de app, WebView.onPause() puede
    // pausar el audio HTML5. Si está sonando, lo reanudamos.
    override fun onPause() {
        super.onPause()
        // También mientras se espera la confirmación del auto-picker: si el
        // WebView se pausa, su temporizador no corre y la siguiente no suena.
        if (MusexPlaybackService.isPlaying || MusexPlaybackService.autoPickActive) {
            webView?.onResume()
        }
    }

    /**
     * Envía una orden al servicio de reproducción.
     *
     * Si el servicio ya existe se usa startService (permitido aunque la
     * app esté en segundo plano). Solo la primera vez se usa
     * startForegroundService.
     */
    private fun sendToService(action: String, fill: Intent.() -> Unit) {

        val intent = Intent(this, MusexPlaybackService::class.java)
            .setAction(action)
            .apply(fill)

        // Desde segundo plano Android puede negar el arranque del servicio
        // (Android 12+). Una orden que no llega no debe cerrar la app.
        try {
            if (MusexPlaybackService.running || Build.VERSION.SDK_INT < 26) {
                startService(intent)
            } else {
                startForegroundService(intent)
            }
        } catch (error: Exception) {
            android.util.Log.w("Musex", "No se pudo enviar $action al servicio", error)
        }
    }

    inner class MusexBridge {

        @JavascriptInterface
        fun safeTop(): Float = safeTopDp

        @JavascriptInterface
        fun safeBottom(): Float = safeBottomDp

        /** Cambió la canción: título, portada, duración y estado. */
        @JavascriptInterface
        fun setNowPlaying(
            title: String,
            artist: String,
            album: String,
            coverUrl: String,
            durationSec: Float,
            positionSec: Float,
            playing: Boolean,
            shuffle: Boolean,
            repeat: String
        ) {
            sendToService(MusexPlaybackService.ACTION_NOW_PLAYING) {
                putExtra("title", title)
                putExtra("artist", artist)
                putExtra("album", album)
                putExtra("cover", coverUrl)
                putExtra("duration", durationSec)
                putExtra("position", positionSec)
                putExtra("playing", playing)
                putExtra("shuffle", shuffle)
                putExtra("repeat", repeat)
            }
        }

        /** Play / pausa / salto de posición. */
        @JavascriptInterface
        fun setPlaybackState(positionSec: Float, playing: Boolean) {
            sendToService(MusexPlaybackService.ACTION_STATE) {
                putExtra("position", positionSec)
                putExtra("playing", playing)
            }
        }

        /** Aleatorio / repetir. */
        @JavascriptInterface
        fun setModes(shuffle: Boolean, repeat: String) {
            sendToService(MusexPlaybackService.ACTION_MODES) {
                putExtra("shuffle", shuffle)
                putExtra("repeat", repeat)
            }
        }

        /** ¿Se puede escribir en la carpeta pública "Musex"? */
        @JavascriptInterface
        fun hasAllFilesAccess(): Boolean =
            if (Build.VERSION.SDK_INT >= 30) {
                Environment.isExternalStorageManager()
            } else {
                checkSelfPermission(Manifest.permission.READ_EXTERNAL_STORAGE) ==
                    PackageManager.PERMISSION_GRANTED &&
                    checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) ==
                    PackageManager.PERMISSION_GRANTED
            }

        /** Abre la pantalla de Android para conceder el acceso. */
        @JavascriptInterface
        fun requestAllFilesAccess() {
            runOnUiThread {
                if (Build.VERSION.SDK_INT >= 30) {
                    try {
                        startActivity(
                            Intent(
                                Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
                                Uri.parse("package:$packageName")
                            )
                        )
                    } catch (error: Exception) {
                        startActivity(Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION))
                    }
                } else {
                    requestPermissions(
                        arrayOf(
                            Manifest.permission.READ_EXTERNAL_STORAGE,
                            Manifest.permission.WRITE_EXTERNAL_STORAGE
                        ),
                        2
                    )
                }
            }
        }

        /**
         * El auto-picker eligió la siguiente canción y espera confirmación:
         * muestra la notificación con "Reproducir ahora" / "Cancelar" y
         * mantiene la app viva hasta que se resuelva.
         */
        @JavascriptInterface
        fun setAutoPick(title: String, artist: String, graceSeconds: Float) {
            // Se marca ya, sin esperar al servicio, para que onPause lo vea.
            MusexPlaybackService.autoPickActive = true

            sendToService(MusexPlaybackService.ACTION_AUTOPICK) {
                putExtra("title", title)
                putExtra("artist", artist)
                putExtra("seconds", graceSeconds)
            }
        }

        /** La espera terminó (se confirmó, canceló o se reemplazó). */
        @JavascriptInterface
        fun clearAutoPick() {
            MusexPlaybackService.autoPickActive = false

            if (MusexPlaybackService.running) {
                sendToService(MusexPlaybackService.ACTION_AUTOPICK_CLEAR) {}
            }
        }

        /** Se terminó la reproducción: quita la notificación. */
        @JavascriptInterface
        fun stop() {
            MusexPlaybackService.isPlaying = false
            stopService(Intent(this@MainActivity, MusexPlaybackService::class.java))
        }
    }
}