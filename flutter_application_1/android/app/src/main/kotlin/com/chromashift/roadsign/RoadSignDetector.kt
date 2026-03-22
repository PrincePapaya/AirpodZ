package com.chromashift.roadsign

import android.content.Context
import org.json.JSONObject
import org.tensorflow.lite.Interpreter
import java.io.Closeable
import java.io.FileInputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.channels.FileChannel
import kotlin.math.max
import kotlin.math.min

class RoadSignDetector(private val context: Context) : Closeable {
    private val assetRoot = "flutter_assets/assets/models"
    private val manifest: DetectorManifest by lazy { loadManifest() }
    private var interpreter: Interpreter? = null
    private val outputShape: IntArray by lazy { interpreterInstance.getOutputTensor(0).shape() }
    private val outputCount: Int by lazy { outputShape.fold(1) { acc, value -> acc * value } }
    private val inputBuffer: ByteBuffer by lazy {
        ByteBuffer.allocateDirect(manifest.inputWidth * manifest.inputHeight * 3 * 4)
            .order(ByteOrder.nativeOrder())
    }
    private val outputBuffer: ByteBuffer by lazy {
        ByteBuffer.allocateDirect(outputCount * 4).order(ByteOrder.nativeOrder())
    }
    private val outputValues: FloatArray by lazy { FloatArray(outputCount) }

    fun analyzeFrame(arguments: Map<*, *>): List<Map<String, Any>> {
        val width = (arguments["width"] as Number).toInt()
        val height = (arguments["height"] as Number).toInt()
        val rotationDegrees = ((arguments["rotationDegrees"] as? Number)?.toInt() ?: 0)
        val isFrontCamera = (arguments["isFrontCamera"] as? Boolean) ?: false
        val planes = (arguments["planes"] as? List<*>)?.map { it as ByteArray }
            ?: error("Missing plane data.")
        val rowStrides = (arguments["bytesPerRow"] as? List<*>)?.map { (it as Number).toInt() }
            ?: error("Missing row strides.")
        val pixelStrides = (arguments["bytesPerPixel"] as? List<*>)?.map {
            (it as? Number)?.toInt() ?: 1
        } ?: error("Missing pixel strides.")

        if (planes.size < 3 || rowStrides.size < 3 || pixelStrides.size < 3) {
            error("Expected YUV420 frame with three planes.")
        }

        fillInputBuffer(
            width = width,
            height = height,
            rotationDegrees = rotationDegrees,
            isFrontCamera = isFrontCamera,
            yPlane = planes[0],
            uPlane = planes[1],
            vPlane = planes[2],
            yRowStride = rowStrides[0],
            uRowStride = rowStrides[1],
            vRowStride = rowStrides[2],
            yPixelStride = pixelStrides[0],
            uPixelStride = pixelStrides[1],
            vPixelStride = pixelStrides[2],
        )

        outputBuffer.clear()
        interpreterInstance.run(inputBuffer, outputBuffer)
        outputBuffer.rewind()
        outputBuffer.asFloatBuffer().get(outputValues)

        return decodeOutput(outputValues).map { detection ->
            hashMapOf<String, Any>(
                "label" to detection.label,
                "score" to detection.score,
                "classIndex" to detection.classIndex,
                "left" to detection.left,
                "top" to detection.top,
                "width" to detection.width,
                "height" to detection.height,
            )
        }
    }

    override fun close() {
        interpreter?.close()
        interpreter = null
    }

    private fun loadManifest(): DetectorManifest {
        val json = context.assets.open("$assetRoot/roadsign_model.json")
            .bufferedReader()
            .use { it.readText() }
        val root = JSONObject(json)
        val labelsJson = root.getJSONArray("labels")
        val labels = buildList(labelsJson.length()) {
            for (index in 0 until labelsJson.length()) {
                add(labelsJson.getString(index))
            }
        }
        return DetectorManifest(
            inputWidth = root.getInt("inputWidth"),
            inputHeight = root.getInt("inputHeight"),
            labels = labels,
            scoreThreshold = root.optDouble("scoreThreshold", 0.35).toFloat(),
            iouThreshold = root.optDouble("iouThreshold", 0.45).toFloat(),
        )
    }

    private fun createInterpreter(): Interpreter {
        val modelDescriptor = context.assets.openFd("$assetRoot/roadsign.tflite")
        val modelBuffer = FileInputStream(modelDescriptor.fileDescriptor).channel.use { channel ->
            channel.map(
                FileChannel.MapMode.READ_ONLY,
                modelDescriptor.startOffset,
                modelDescriptor.declaredLength,
            )
        }
        val options = Interpreter.Options().apply { setNumThreads(4) }
        return Interpreter(modelBuffer, options)
    }

    private val interpreterInstance: Interpreter
        get() {
            val current = interpreter
            if (current != null) {
                return current
            }
            return createInterpreter().also { interpreter = it }
        }

    private fun fillInputBuffer(
        width: Int,
        height: Int,
        rotationDegrees: Int,
        isFrontCamera: Boolean,
        yPlane: ByteArray,
        uPlane: ByteArray,
        vPlane: ByteArray,
        yRowStride: Int,
        uRowStride: Int,
        vRowStride: Int,
        yPixelStride: Int,
        uPixelStride: Int,
        vPixelStride: Int,
    ) {
        inputBuffer.clear()
        val normalizedRotation = ((rotationDegrees % 360) + 360) % 360
        val orientedWidth = if (normalizedRotation == 90 || normalizedRotation == 270) height else width
        val orientedHeight = if (normalizedRotation == 90 || normalizedRotation == 270) width else height

        for (targetY in 0 until manifest.inputHeight) {
            val orientedY = (((targetY + 0.5f) * orientedHeight) / manifest.inputHeight)
                .toInt()
                .coerceIn(0, orientedHeight - 1)
            for (targetX in 0 until manifest.inputWidth) {
                var sampledOrientedX = (((targetX + 0.5f) * orientedWidth) / manifest.inputWidth)
                    .toInt()
                    .coerceIn(0, orientedWidth - 1)
                if (isFrontCamera) {
                    sampledOrientedX = orientedWidth - 1 - sampledOrientedX
                }
                val (rawX, rawY) = mapOrientedToRaw(
                    x = sampledOrientedX,
                    y = orientedY,
                    width = width,
                    height = height,
                    rotationDegrees = normalizedRotation,
                )
                val yIndex = rawY * yRowStride + rawX * yPixelStride
                val uvX = rawX / 2
                val uvY = rawY / 2
                val uIndex = uvY * uRowStride + uvX * uPixelStride
                val vIndex = uvY * vRowStride + uvX * vPixelStride

                val yValue = yPlane[yIndex].toInt() and 0xFF
                val uValue = (uPlane[uIndex].toInt() and 0xFF) - 128
                val vValue = (vPlane[vIndex].toInt() and 0xFF) - 128

                val r = clampColor(yValue + 1.402f * vValue)
                val g = clampColor(yValue - 0.344136f * uValue - 0.714136f * vValue)
                val b = clampColor(yValue + 1.772f * uValue)

                inputBuffer.putFloat(r / 255f)
                inputBuffer.putFloat(g / 255f)
                inputBuffer.putFloat(b / 255f)
            }
        }
        inputBuffer.rewind()
    }

    private fun decodeOutput(output: FloatArray): List<Detection> {
        val labels = manifest.labels
        val stride = 4 + labels.size
        if (output.size < stride || output.size % stride != 0) {
            return emptyList()
        }

        val anchorCount = output.size / stride
        val raw = ArrayList<Detection>()

        for (anchor in 0 until anchorCount) {
            var bestClass = 0
            var bestScore = 0f
            for (classIndex in labels.indices) {
                val score = output[(4 + classIndex) * anchorCount + anchor]
                if (score > bestScore) {
                    bestScore = score
                    bestClass = classIndex
                }
            }

            if (bestScore < manifest.scoreThreshold) {
                continue
            }

            val x = output[anchor]
            val y = output[anchorCount + anchor]
            val w = output[anchorCount * 2 + anchor]
            val h = output[anchorCount * 3 + anchor]

            raw += Detection(
                label = labels.getOrElse(bestClass) { "Class ${bestClass + 1}" },
                score = bestScore,
                left = clipUnit((x - w / 2f) / manifest.inputWidth),
                top = clipUnit((y - h / 2f) / manifest.inputHeight),
                width = clipUnit(w / manifest.inputWidth),
                height = clipUnit(h / manifest.inputHeight),
                classIndex = bestClass,
            )
        }

        raw.sortByDescending { it.score }
        val picked = ArrayList<Detection>()
        for (candidate in raw) {
            val suppressed = picked.any {
                it.classIndex == candidate.classIndex &&
                    intersectionOverUnion(it, candidate) > manifest.iouThreshold
            }
            if (!suppressed) {
                picked += candidate
            }
            if (picked.size == 8) {
                break
            }
        }
        return picked
    }

    private fun mapOrientedToRaw(
        x: Int,
        y: Int,
        width: Int,
        height: Int,
        rotationDegrees: Int,
    ): Pair<Int, Int> = when (rotationDegrees) {
        90 -> Pair(y, height - 1 - x)
        180 -> Pair(width - 1 - x, height - 1 - y)
        270 -> Pair(width - 1 - y, x)
        else -> Pair(x, y)
    }

    private fun clampColor(value: Float): Float = min(255f, max(0f, value))

    private fun clipUnit(value: Float): Float = min(1f, max(0f, value))

    private fun intersectionOverUnion(a: Detection, b: Detection): Float {
        val ax2 = a.left + a.width
        val ay2 = a.top + a.height
        val bx2 = b.left + b.width
        val by2 = b.top + b.height

        val x1 = max(a.left, b.left)
        val y1 = max(a.top, b.top)
        val x2 = min(ax2, bx2)
        val y2 = min(ay2, by2)

        val intersection = max(0f, x2 - x1) * max(0f, y2 - y1)
        val union = a.width * a.height + b.width * b.height - intersection
        return if (union <= 0f) 0f else intersection / union
    }

    private data class DetectorManifest(
        val inputWidth: Int,
        val inputHeight: Int,
        val labels: List<String>,
        val scoreThreshold: Float,
        val iouThreshold: Float,
    )

    private data class Detection(
        val label: String,
        val score: Float,
        val left: Float,
        val top: Float,
        val width: Float,
        val height: Float,
        val classIndex: Int,
    )
}
