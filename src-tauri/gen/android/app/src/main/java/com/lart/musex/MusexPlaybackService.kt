package com.lart.musex

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.drawable.Icon
import android.media.MediaMetadata
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import java.net.HttpURLConnection
import java.net.URL
import kotlin.math.min

/**
 * Reproductor en segundo plano de Musex.
 *
 * Igual que Spotify y el resto de reproductores modernos, usa:
 *
 *  - MediaSession: es lo que Android lee para dibujar los controles
 *    del panel de notificaciones, la pantalla de bloqueo, los
 *    controles multimedia rápidos (Android 13+), los audífonos
 *    Bluetooth y los relojes. Incluye portada, barra de progreso
 *    y los botones aleatorio / anterior / play / siguiente / repetir.
 *
 *  - Notification.MediaStyle: la notificación en sí, con la portada
 *    como imagen grande y el color derivado de la portada.
 *
 *  - Servicio en primer plano + WakeLock/WifiLock: la música sigue
 *    con la pantalla apagada o en otra app.
 *
 * El audio lo reproduce el WebView (Angular). Este servicio solo
 * muestra el estado y reenvía los botones a la app.
 */
class MusexPlaybackService : Service() {

    companion object {

        @Volatile var isPlaying = false

        /** true mientras el servicio existe (ver MainActivity). */
        @Volatile var running = false

        /** Reenvía un comando a la app (WebView). */
        var commandHandler: ((String) -> Unit)? = null

        const val CHANNEL_ID = "musex_playback"
        const val NOTIFICATION_ID = 1

        // Órdenes que llegan desde la app (MainActivity)
        const val ACTION_NOW_PLAYING = "com.lart.musex.NOW_PLAYING"
        const val ACTION_STATE = "com.lart.musex.STATE"
        const val ACTION_MODES = "com.lart.musex.MODES"

        // Botones de la notificación
        const val ACTION_PREV = "com.lart.musex.PREV"
        const val ACTION_TOGGLE = "com.lart.musex.TOGGLE"
        const val ACTION_NEXT = "com.lart.musex.NEXT"
        const val ACTION_SHUFFLE = "com.lart.musex.SHUFFLE"
        const val ACTION_REPEAT = "com.lart.musex.REPEAT"
        const val ACTION_DISMISS = "com.lart.musex.DISMISS"

        private const val BRAND_DARK = "#111214"
        private const val BRAND_ACCENT = "#9CFF00"
        private const val ART_SIZE = 512
    }

    // ---------------------------------------------------------
    // ESTADO
    // ---------------------------------------------------------

    private var title = "Musex"
    private var artist = ""
    private var album = ""

    private var durationMs = 0L
    private var positionMs = 0L

    private var shuffle = false
    private var repeatMode = "off"     // off | track | queue

    private var art: Bitmap? = null
    private var artUrl = ""
    private var artGeneration = 0

    private var cardColor = Color.parseColor(BRAND_DARK)

    private var session: MediaSession? = null
    private var isForeground = false
    private var hasEnteredForeground = false

    private val mainHandler = Handler(Looper.getMainLooper())

    private var wakeLock: PowerManager.WakeLock? = null
    private var wifiLock: WifiManager.WifiLock? = null


    // ---------------------------------------------------------
    // CICLO DE VIDA
    // ---------------------------------------------------------

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()

        running = true

        createChannel()

        art = fallbackArt()
        cardColor = brandedColor(art)

        session = MediaSession(this, "MusexSession").apply {
            setCallback(sessionCallback)
            setSessionActivity(openAppIntent())
            isActive = true
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {

        when (intent?.action) {

            // ---- Botones de la notificación ----

            ACTION_PREV -> send("prev")
            ACTION_TOGGLE -> send("toggle")
            ACTION_NEXT -> send("next")
            ACTION_SHUFFLE -> send("shuffle")
            ACTION_REPEAT -> send("repeat")

            ACTION_DISMISS -> {
                // El usuario quitó la notificación (solo posible en pausa).
                if (!isPlaying) shutdown()
            }

            // ---- Órdenes de la app ----

            ACTION_NOW_PLAYING -> {

                title = intent.getStringExtra("title").orEmpty().ifBlank { "Musex" }
                artist = intent.getStringExtra("artist").orEmpty()
                album = intent.getStringExtra("album").orEmpty()

                durationMs = (intent.getFloatExtra("duration", 0f) * 1000).toLong()
                positionMs = (intent.getFloatExtra("position", 0f) * 1000).toLong()

                isPlaying = intent.getBooleanExtra("playing", true)

                shuffle = intent.getBooleanExtra("shuffle", false)
                repeatMode = intent.getStringExtra("repeat") ?: "off"

                val cover = intent.getStringExtra("cover").orEmpty()

                if (cover != artUrl) {
                    artUrl = cover

                    // Mientras llega la portada se muestra el disco de Musex.
                    art = fallbackArt()
                    cardColor = brandedColor(art)

                    if (cover.startsWith("http")) loadArt(cover)
                }

                publish()
            }

            ACTION_STATE -> {
                positionMs = (intent.getFloatExtra("position", 0f) * 1000).toLong()
                isPlaying = intent.getBooleanExtra("playing", isPlaying)

                publish()
            }

            ACTION_MODES -> {
                shuffle = intent.getBooleanExtra("shuffle", shuffle)
                repeatMode = intent.getStringExtra("repeat") ?: repeatMode

                publish()
            }
        }

        return START_NOT_STICKY
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        shutdown()
        super.onTaskRemoved(rootIntent)
    }

    override fun onDestroy() {
        running = false
        isPlaying = false

        artGeneration++               // descarta cualquier portada en camino

        releaseLocks()

        session?.release()
        session = null

        super.onDestroy()
    }

    private fun shutdown() {
        isPlaying = false

        releaseLocks()
        leaveForeground()

        stopSelf()
    }


    // ---------------------------------------------------------
    // PUBLICAR (sesión + notificación)
    // ---------------------------------------------------------

    private fun publish() {

        updateSession()

        val notification = buildNotification()

        if (isPlaying) {

            enterForeground(notification)
            acquireLocks()

        } else {

            // Android exige startForeground() tras startForegroundService().
            if (!hasEnteredForeground) enterForeground(notification)

            // En pausa la notificación se puede descartar con un deslizamiento.
            leaveForeground()

            getSystemService(NotificationManager::class.java)
                .notify(NOTIFICATION_ID, notification)

            releaseLocks()
        }
    }

    private fun enterForeground(notification: Notification) {

        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }

        isForeground = true
        hasEnteredForeground = true
    }

    private fun leaveForeground() {

        if (!isForeground) return

        if (Build.VERSION.SDK_INT >= 24) {
            stopForeground(STOP_FOREGROUND_DETACH)
        } else {
            @Suppress("DEPRECATION")
            stopForeground(false)
        }

        isForeground = false
    }


    // ---------------------------------------------------------
    // MEDIA SESSION
    // ---------------------------------------------------------

    private val sessionCallback = object : MediaSession.Callback() {

        override fun onPlay() = send("play")

        override fun onPause() = send("pause")

        override fun onSkipToNext() = send("next")

        override fun onSkipToPrevious() = send("prev")

        override fun onSeekTo(pos: Long) = send("seek:${pos / 1000.0}")

        override fun onCustomAction(action: String, extras: Bundle?) {
            when (action) {
                ACTION_SHUFFLE -> send("shuffle")
                ACTION_REPEAT -> send("repeat")
            }
        }
    }

    private fun updateSession() {

        val current = session ?: return

        // ---- Qué se está reproduciendo ----

        val metadata = MediaMetadata.Builder()
            .putString(MediaMetadata.METADATA_KEY_TITLE, title)
            .putString(MediaMetadata.METADATA_KEY_ARTIST, artist)
            .putString(MediaMetadata.METADATA_KEY_ALBUM, album)

        art?.let { metadata.putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, it) }

        if (durationMs > 0) {
            metadata.putLong(MediaMetadata.METADATA_KEY_DURATION, durationMs)
        }

        current.setMetadata(metadata.build())

        // ---- Cómo va (posición, botones disponibles) ----

        val actions =
            PlaybackState.ACTION_PLAY or
                PlaybackState.ACTION_PAUSE or
                PlaybackState.ACTION_PLAY_PAUSE or
                PlaybackState.ACTION_SKIP_TO_NEXT or
                PlaybackState.ACTION_SKIP_TO_PREVIOUS or
                PlaybackState.ACTION_SEEK_TO

        val playbackState = PlaybackState.Builder()
            .setActions(actions)
            .setState(
                if (isPlaying) PlaybackState.STATE_PLAYING else PlaybackState.STATE_PAUSED,
                positionMs.coerceAtLeast(0L),
                if (isPlaying) 1f else 0f
            )
            .addCustomAction(
                PlaybackState.CustomAction.Builder(
                    ACTION_SHUFFLE,
                    "Aleatorio",
                    if (shuffle) R.drawable.musex_ic_shuffle_on else R.drawable.musex_ic_shuffle_off
                ).build()
            )
            .addCustomAction(
                PlaybackState.CustomAction.Builder(
                    ACTION_REPEAT,
                    "Repetir",
                    when (repeatMode) {
                        "track" -> R.drawable.musex_ic_repeat_one
                        "queue" -> R.drawable.musex_ic_repeat_all
                        else -> R.drawable.musex_ic_repeat_off
                    }
                ).build()
            )
            .build()

        current.setPlaybackState(playbackState)
    }


    // ---------------------------------------------------------
    // NOTIFICACIÓN
    // ---------------------------------------------------------

    private fun createChannel() {

        if (Build.VERSION.SDK_INT < 26) return

        val manager = getSystemService(NotificationManager::class.java)

        if (manager.getNotificationChannel(CHANNEL_ID) != null) return

        val channel = NotificationChannel(
            CHANNEL_ID,
            "Reproducción",
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "Controles de la música que está sonando"
            setShowBadge(false)
            lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        }

        manager.createNotificationChannel(channel)
    }

    private fun buildNotification(): Notification {

        val builder = if (Build.VERSION.SDK_INT >= 26) {
            Notification.Builder(this, CHANNEL_ID)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
        }

        // Orden: aleatorio · anterior · play/pausa · siguiente · repetir
        // En la vista compacta se muestran anterior, play/pausa y siguiente.
        builder
            .setSmallIcon(R.drawable.ic_stat_musex)
            .setContentTitle(title)
            .setContentText(artist)
            .setSubText(album.takeIf { it.isNotBlank() })
            .setLargeIcon(art)
            .setContentIntent(openAppIntent())
            .setDeleteIntent(servicePendingIntent(ACTION_DISMISS))
            .setCategory(Notification.CATEGORY_TRANSPORT)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .setOngoing(isPlaying)
            .setColor(cardColor)
            .addAction(
                action(
                    if (shuffle) R.drawable.musex_ic_shuffle_on else R.drawable.musex_ic_shuffle_off,
                    "Aleatorio",
                    ACTION_SHUFFLE
                )
            )
            .addAction(action(R.drawable.musex_ic_previous, "Anterior", ACTION_PREV))
            .addAction(
                action(
                    if (isPlaying) R.drawable.musex_ic_pause else R.drawable.musex_ic_play,
                    if (isPlaying) "Pausa" else "Reproducir",
                    ACTION_TOGGLE
                )
            )
            .addAction(action(R.drawable.musex_ic_next, "Siguiente", ACTION_NEXT))
            .addAction(
                action(
                    when (repeatMode) {
                        "track" -> R.drawable.musex_ic_repeat_one
                        "queue" -> R.drawable.musex_ic_repeat_all
                        else -> R.drawable.musex_ic_repeat_off
                    },
                    "Repetir",
                    ACTION_REPEAT
                )
            )

        if (Build.VERSION.SDK_INT >= 26) {
            builder.setColorized(true)
        }

        val style = Notification.MediaStyle()
            .setShowActionsInCompactView(1, 2, 3)

        session?.let { style.setMediaSession(it.sessionToken) }

        builder.setStyle(style)

        return builder.build()
    }

    private fun action(icon: Int, label: String, action: String): Notification.Action =
        Notification.Action.Builder(
            Icon.createWithResource(this, icon),
            label,
            servicePendingIntent(action)
        ).build()

    private fun servicePendingIntent(action: String): PendingIntent =
        PendingIntent.getService(
            this,
            action.hashCode(),
            Intent(this, MusexPlaybackService::class.java).setAction(action),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

    private fun openAppIntent(): PendingIntent =
        PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

    private fun send(command: String) {
        commandHandler?.invoke(command)
    }


    // ---------------------------------------------------------
    // PORTADA
    // ---------------------------------------------------------

    /** Descarga la portada fuera del hilo principal. */
    private fun loadArt(url: String) {

        val generation = ++artGeneration

        Thread {

            val bitmap = try {
                downloadCover(url)
            } catch (error: Exception) {
                null
            }

            if (bitmap != null) {
                mainHandler.post {
                    // Si cambió la canción mientras bajaba, se descarta.
                    if (running && generation == artGeneration) {
                        art = bitmap
                        cardColor = brandedColor(bitmap)
                        publish()
                    }
                }
            }

        }.start()
    }

    private fun downloadCover(url: String): Bitmap? {

        val connection = URL(url).openConnection() as HttpURLConnection

        connection.connectTimeout = 4000
        connection.readTimeout = 8000

        try {

            if (connection.responseCode !in 200..299) return null

            val bytes = connection.inputStream.use { it.readBytes() }

            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)

            var sample = 1
            while (bounds.outWidth / sample > 1024 || bounds.outHeight / sample > 1024) {
                sample *= 2
            }

            val options = BitmapFactory.Options().apply { inSampleSize = sample }
            val decoded = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
                ?: return null

            // Cuadrada y de tamaño fijo: ligera para el sistema.
            val side = min(decoded.width, decoded.height)

            val square = Bitmap.createBitmap(
                decoded,
                (decoded.width - side) / 2,
                (decoded.height - side) / 2,
                side,
                side
            )

            return Bitmap.createScaledBitmap(square, ART_SIZE, ART_SIZE, true)

        } finally {
            connection.disconnect()
        }
    }

    /**
     * Color de la tarjeta: el color promedio de la portada, oscurecido
     * para que el texto blanco siempre se lea bien y combine con el
     * fondo oscuro de Musex.
     */
    private fun brandedColor(bitmap: Bitmap?): Int {

        val fallback = Color.parseColor(BRAND_DARK)

        if (bitmap == null) return fallback

        val pixel = Bitmap.createScaledBitmap(bitmap, 1, 1, true).getPixel(0, 0)

        val hsv = FloatArray(3)
        Color.colorToHSV(pixel, hsv)

        hsv[1] = min(hsv[1], 0.70f)
        hsv[2] = hsv[2].coerceIn(0.14f, 0.34f)

        return Color.HSVToColor(hsv)
    }

    /** Disco de Musex: se usa cuando una canción no tiene portada. */
    private fun fallbackArt(): Bitmap {

        val bitmap = Bitmap.createBitmap(ART_SIZE, ART_SIZE, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)

        val dark = Color.parseColor(BRAND_DARK)
        val accent = Color.parseColor(BRAND_ACCENT)

        canvas.drawColor(dark)

        val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        val center = ART_SIZE / 2f

        // Disco
        paint.style = Paint.Style.FILL
        paint.color = accent
        canvas.drawCircle(center, center, ART_SIZE * 0.40f, paint)

        // Surcos
        paint.style = Paint.Style.STROKE
        paint.strokeWidth = 3f
        paint.color = dark
        paint.alpha = 90

        for (radius in floatArrayOf(0.34f, 0.28f, 0.22f)) {
            canvas.drawCircle(center, center, ART_SIZE * radius, paint)
        }

        // Etiqueta y centro
        paint.style = Paint.Style.FILL
        paint.color = dark
        canvas.drawCircle(center, center, ART_SIZE * 0.11f, paint)

        paint.color = accent
        canvas.drawCircle(center, center, ART_SIZE * 0.035f, paint)

        return bitmap
    }


    // ---------------------------------------------------------
    // CPU / Wi-Fi
    // ---------------------------------------------------------

    @Suppress("DEPRECATION")
    private fun acquireLocks() {

        if (wakeLock == null) {
            val power = getSystemService(Context.POWER_SERVICE) as PowerManager

            wakeLock = power
                .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Musex:playback")
                .apply { setReferenceCounted(false) }
        }

        if (wifiLock == null) {
            val wifi = applicationContext
                .getSystemService(Context.WIFI_SERVICE) as WifiManager

            wifiLock = wifi
                .createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "Musex:wifi")
                .apply { setReferenceCounted(false) }
        }

        if (wakeLock?.isHeld == false) wakeLock?.acquire()
        if (wifiLock?.isHeld == false) wifiLock?.acquire()
    }

    private fun releaseLocks() {
        if (wakeLock?.isHeld == true) wakeLock?.release()
        if (wifiLock?.isHeld == true) wifiLock?.release()
    }
}