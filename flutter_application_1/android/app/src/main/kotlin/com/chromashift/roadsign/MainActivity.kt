package com.chromashift.roadsign

import android.os.Handler
import android.os.Looper
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

class MainActivity : FlutterActivity() {
    private val detectorChannel = "chromashift/detector"
    private val mainHandler = Handler(Looper.getMainLooper())
    private lateinit var detector: RoadSignDetector
    private lateinit var detectorExecutor: ExecutorService

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        detector = RoadSignDetector(applicationContext)
        detectorExecutor = Executors.newSingleThreadExecutor()

        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, detectorChannel)
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "analyzeFrame" -> runAnalyzeFrame(call, result)
                    else -> result.notImplemented()
                }
            }
    }

    override fun onDestroy() {
        if (::detectorExecutor.isInitialized) {
            detectorExecutor.shutdownNow()
        }
        if (::detector.isInitialized) {
            detector.close()
        }
        super.onDestroy()
    }

    private fun runAnalyzeFrame(call: MethodCall, result: MethodChannel.Result) {
        val arguments = call.arguments as? Map<*, *>
        if (arguments == null) {
            result.error("bad_args", "Expected a frame payload map.", null)
            return
        }

        detectorExecutor.execute {
            try {
                val detections = detector.analyzeFrame(arguments)
                mainHandler.post { result.success(detections) }
            } catch (error: Throwable) {
                mainHandler.post {
                    result.error("detector_failed", error.message, error.stackTraceToString())
                }
            }
        }
    }
}
