import 'dart:async';
import 'dart:convert';
import 'dart:math' as math;

import 'package:camera/camera.dart';
import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';
import 'package:flutter/services.dart';
import 'package:flutter_shaders/flutter_shaders.dart';
import 'package:flutter_tts/flutter_tts.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(App(cameras: await availableCameras()));
}

class App extends StatelessWidget {
  const App({super.key, required this.cameras});

  final List<CameraDescription> cameras;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'ChromaShitf',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(colorScheme: ColorScheme.fromSeed(seedColor: Colors.teal)),
      home: Home(cameras: cameras),
    );
  }
}

class Home extends StatefulWidget {
  const Home({super.key, required this.cameras});

  final List<CameraDescription> cameras;

  @override
  State<Home> createState() => _HomeState();
}

class _HomeState extends State<Home> with SingleTickerProviderStateMixin {
  static const _detectorChannel = MethodChannel('chromashift/detector');
  static const _overlayTimeout = Duration(seconds: 3);
  static const _announceGap = Duration(milliseconds: 900);
  static const _repeatWhileVisible = Duration(days: 365);
  static const _framesToTrigger = 2;
  static const _framesToReset = 5;
  static const _detectionStride = 15;

  final _tts = FlutterTts();
  final _previewTick = ValueNotifier<int>(0);
  final _detectionsNotifier = ValueNotifier<List<RoadSignDetection>>(
    const <RoadSignDetection>[],
  );
  final _presentStreaks = <String, int>{};
  final _missingStreaks = <String, int>{};
  final _lastAnnouncedAt = <String, DateTime>{};
  final _activeLabels = <String>{};

  CameraController? _camera;
  RoadSignModelManifest? _manifest;
  Timer? _overlayTimer;
  late final Ticker _previewTicker;

  DateTime _lastGlobalAnnouncement = DateTime.fromMillisecondsSinceEpoch(0);
  int _cameraIndex = 0;
  int _detectionFrameCount = 0;
  bool _swapRedBlue = true;
  bool _yellowToCyan = true;
  bool _roadGuide = false;
  bool _showControls = false;
  bool _overlayVisible = true;
  bool _detecting = false;
  double _zoomScale = 1;
  double _zoomStartScale = 1;
  String _status = 'Initializing camera...';
  ModelState _modelState = ModelState.loading;
  ViewMode _viewMode = ViewMode.split;
  List<RoadSignDetection> _detections = const [];

  @override
  void initState() {
    super.initState();
    final preferred = widget.cameras.indexWhere(
      (camera) => camera.lensDirection == CameraLensDirection.back,
    );
    if (preferred >= 0) _cameraIndex = preferred;
    _previewTicker = createTicker((_) => _previewTick.value++)..start();
    unawaited(_tts.setSpeechRate(0.48));
    unawaited(_tts.setPitch(1.0));
    unawaited(_tts.awaitSpeakCompletion(true));
    unawaited(_loadModel());
    unawaited(_startCamera());
  }

  @override
  void dispose() {
    _previewTicker.dispose();
    _previewTick.dispose();
    _detectionsNotifier.dispose();
    _overlayTimer?.cancel();
    unawaited(_tts.stop());
    unawaited(_camera?.dispose());
    super.dispose();
  }

  Future<void> _loadModel() async {
    try {
      final json = jsonDecode(
        await rootBundle.loadString('assets/models/roadsign_model.json'),
      ) as Map<String, dynamic>;
      final manifest = RoadSignModelManifest.fromJson(json);
      if (!mounted) {
        return;
      }
      setState(() {
        _manifest = manifest;
        _modelState = ModelState.ready;
      });
      await _syncImageStream();
    } catch (error) {
      if (mounted) {
        setState(() {
          _modelState = ModelState.error;
          _status = 'Road-sign model failed to load: $error';
        });
      }
    }
  }

  Future<void> _startCamera() async {
    if (widget.cameras.isEmpty) {
      setState(() => _status = 'No camera detected on this device.');
      return;
    }
    final description = widget.cameras[_cameraIndex.clamp(0, widget.cameras.length - 1)];
    final controller = CameraController(
      description,
      ResolutionPreset.medium,
      enableAudio: false,
    );
    try {
      await controller.initialize();
      if (!mounted) {
        await controller.dispose();
        return;
      }
      setState(() {
        _camera = controller;
        if (_modelState != ModelState.error) _status = '';
      });
      _revealOverlay();
      await _syncImageStream();
    } catch (error) {
      await controller.dispose();
      if (mounted) setState(() => _status = 'Camera initialization failed: $error');
    }
  }

  Future<void> _flipCamera() async {
    if (widget.cameras.length < 2) {
      setState(() => _status = 'Only one camera is available.');
      return;
    }
    _revealOverlay();
    final previous = _camera;
    setState(() {
      _status = 'Switching camera...';
      _camera = null;
      _cameraIndex = (_cameraIndex + 1) % widget.cameras.length;
      _detections = const [];
    });
    _detectionsNotifier.value = const <RoadSignDetection>[];
    if (previous?.value.isStreamingImages ?? false) await previous!.stopImageStream();
    await previous?.dispose();
    await _startCamera();
  }

  Future<void> _syncImageStream() async {
    final camera = _camera;
    if (camera == null || !camera.value.isInitialized) return;
    final shouldStream = _roadGuide && _modelState == ModelState.ready && _manifest != null;
    if (shouldStream && !camera.value.isStreamingImages) {
      _detectionFrameCount = 0;
      await camera.startImageStream(_onFrame);
    } else if (!shouldStream && camera.value.isStreamingImages) {
      await camera.stopImageStream();
      _detections = const [];
      _detectionsNotifier.value = const <RoadSignDetection>[];
    }
  }

  Future<void> _onFrame(CameraImage frame) async {
    if (_detecting) return;
    _detectionFrameCount++;
    if (_detectionFrameCount % _detectionStride != 0) return;
    final camera = _camera;
    final manifest = _manifest;
    if (!_roadGuide || camera == null || manifest == null) {
      return;
    }
    _detecting = true;
    try {
      final response = await _detectorChannel.invokeListMethod<dynamic>(
        'analyzeFrame',
        <String, Object?>{
          'width': frame.width,
          'height': frame.height,
          'rotationDegrees': camera.description.sensorOrientation,
          'isFrontCamera': camera.description.lensDirection == CameraLensDirection.front,
          'planes': frame.planes.map((plane) => plane.bytes).toList(growable: false),
          'bytesPerRow': frame.planes.map((plane) => plane.bytesPerRow).toList(growable: false),
          'bytesPerPixel': frame.planes
              .map((plane) => plane.bytesPerPixel ?? 1)
              .toList(growable: false),
        },
      );
      final detections = _parseNativeDetections(response, manifest);
      if (!mounted) return;
      if (!_sameDetections(_detections, detections)) {
        _detections = detections;
        _detectionsNotifier.value = detections;
      }
      await _handleSpeech(detections);
    } catch (error) {
      if (mounted) setState(() => _status = 'Road-sign detection failed: $error');
    } finally {
      _detecting = false;
    }
  }

  Future<void> _handleSpeech(List<RoadSignDetection> detections) async {
    final now = DateTime.now();
    final currentLabels = detections.map((d) => d.label).toSet();
    for (final label in currentLabels) {
      _presentStreaks[label] = (_presentStreaks[label] ?? 0) + 1;
      _missingStreaks[label] = 0;
    }
    final tracked = <String>{
      ..._presentStreaks.keys,
      ..._missingStreaks.keys,
      ..._lastAnnouncedAt.keys,
      ..._activeLabels,
    };
    for (final label in tracked.difference(currentLabels)) {
      _presentStreaks[label] = 0;
      _missingStreaks[label] = (_missingStreaks[label] ?? 0) + 1;
      if ((_missingStreaks[label] ?? 0) >= _framesToReset) {
        _activeLabels.remove(label);
        _lastAnnouncedAt.remove(label);
      }
    }
    final speakQueue = currentLabels.where((label) {
      return (_presentStreaks[label] ?? 0) >= _framesToTrigger &&
          !_activeLabels.contains(label) &&
          now.difference(
                _lastAnnouncedAt[label] ?? DateTime.fromMillisecondsSinceEpoch(0),
              ) >=
              _repeatWhileVisible;
    }).toList()
      ..sort();
    if (speakQueue.isEmpty || now.difference(_lastGlobalAnnouncement) < _announceGap) {
      return;
    }
    final label = speakQueue.first;
    _activeLabels.add(label);
    _lastAnnouncedAt[label] = now;
    _lastGlobalAnnouncement = now;
    await _tts.stop();
    await _tts.speak('There may be a potential $label ahead');
  }

  void _revealOverlay() {
    _overlayTimer?.cancel();
    if (mounted) setState(() => _overlayVisible = true);
    _overlayTimer = Timer(_overlayTimeout, () {
      if (mounted && !_showControls) setState(() => _overlayVisible = false);
    });
  }

  @override
  Widget build(BuildContext context) {
    final ready = _camera?.value.isInitialized == true;
    return Scaffold(
      body: SafeArea(
        child: GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTap: _revealOverlay,
          onScaleStart: (_) => _zoomStartScale = _zoomScale,
          onScaleUpdate: (details) {
            final nextScale = (_zoomStartScale * details.scale).clamp(1.0, 4.0);
            if (nextScale != _zoomScale) setState(() => _zoomScale = nextScale);
          },
          child: Stack(
            children: [
              Positioned.fill(
                child: ready
                    ? _buildPreviewArea()
                    : Center(child: Text(_status, textAlign: TextAlign.center)),
              ),
              Positioned.fill(
                child: IgnorePointer(
                  ignoring: !_overlayVisible,
                  child: AnimatedOpacity(
                    opacity: _overlayVisible ? 1 : 0,
                    duration: const Duration(milliseconds: 250),
                    child: Stack(
                      children: [
                        Positioned(
                          top: 16,
                          left: 16,
                          right: 16,
                          child: Row(
                            mainAxisAlignment: MainAxisAlignment.end,
                            children: [
                              if (_status.isNotEmpty) Expanded(child: _statusChip(_status)),
                              if (_status.isNotEmpty) const SizedBox(width: 12),
                              _topButton(Icons.cameraswitch, _flipCamera),
                              const SizedBox(width: 12),
                              _topButton(
                                _showControls ? Icons.close : Icons.tune,
                                () => setState(() => _showControls = !_showControls),
                              ),
                            ],
                          ),
                        ),
                        if (_showControls)
                          Positioned(
                            top: 80,
                            right: 16,
                            child: ConstrainedBox(
                              constraints: const BoxConstraints(maxWidth: 340),
                              child: Material(
                                color: Colors.black87,
                                borderRadius: BorderRadius.circular(18),
                                child: Padding(
                                  padding: const EdgeInsets.all(12),
                                  child: Column(
                                    mainAxisSize: MainAxisSize.min,
                                    children: [
                                      _switchTile(
                                        label: 'Swap red and blue',
                                        subtitle: 'Color assist for saturated reds and blues',
                                        value: _swapRedBlue,
                                        onChanged: (value) => setState(() => _swapRedBlue = value),
                                      ),
                                      _switchTile(
                                        label: 'Shift yellow to cyan',
                                        subtitle: 'One-way yellow to cyan assist',
                                        value: _yellowToCyan,
                                        onChanged: (value) => setState(() => _yellowToCyan = value),
                                      ),
                                      _switchTile(
                                        label: 'Road sign guidance',
                                        subtitle: _modelState == ModelState.ready
                                            ? 'Run sign detection, outlines, and spoken alerts'
                                            : _modelState == ModelState.loading
                                                ? 'Loading mobile detector...'
                                                : 'Model unavailable',
                                        value: _roadGuide && _modelState == ModelState.ready,
                                        onChanged: _modelState == ModelState.ready
                                            ? (value) async {
                                              setState(() => _roadGuide = value);
                                              if (!value) await _tts.stop();
                                              await _syncImageStream();
                                            }
                                            : null,
                                      ),
                                    ],
                                  ),
                                ),
                              ),
                            ),
                          ),
                      ],
                    ),
                  ),
                ),
              ),
              Positioned(
                top: 16,
                right: 16,
                child: AnimatedOpacity(
                  opacity: _overlayVisible ? 0 : 0.55,
                  duration: const Duration(milliseconds: 250),
                  child: IgnorePointer(
                    ignoring: _overlayVisible,
                    child: Material(
                      color: Colors.black45,
                      borderRadius: BorderRadius.circular(14),
                      child: IconButton(
                        onPressed: () {
                          _revealOverlay();
                          setState(() => _showControls = true);
                        },
                        icon: const Icon(Icons.tune, color: Colors.white),
                      ),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildPreviewArea() {
    final original = _panel(
      label: 'Original',
      mode: ViewMode.originalOnly,
      child: _previewSurface(processed: false),
    );
    final processed = _panel(
      label: 'Color Assist',
      mode: ViewMode.processedOnly,
      child: _previewSurface(processed: true),
    );
    return switch (_viewMode) {
      ViewMode.originalOnly => original,
      ViewMode.processedOnly => processed,
      ViewMode.split => Column(
          children: [
            Expanded(child: original),
            const SizedBox(height: 2),
            Expanded(child: processed),
          ],
        ),
    };
  }

  Widget _previewSurface({required bool processed}) {
    final camera = _camera;
    if (camera == null) return const SizedBox.shrink();
    final preview = _previewViewport(child: CameraPreview(camera));
    final base = processed
        ? ValueListenableBuilder<int>(
            valueListenable: _previewTick,
            builder: (context, _, child) => ShaderBuilder(
              assetKey: 'shaders/color_assist.frag',
              child: preview,
              (context, shader, child) => AnimatedSampler(
                enabled: _swapRedBlue || _yellowToCyan,
                child: child!,
                (image, size, canvas) {
                  shader
                    ..setFloat(0, size.width)
                    ..setFloat(1, size.height)
                    ..setFloat(2, _swapRedBlue ? 1 : 0)
                    ..setFloat(3, _yellowToCyan ? 1 : 0)
                    ..setImageSampler(0, image);
                  canvas.drawRect(Offset.zero & size, Paint()..shader = shader);
                },
              ),
            ),
          )
        : preview;
    return Stack(
      fit: StackFit.expand,
      children: [
        base,
        if (_roadGuide)
          ValueListenableBuilder<List<RoadSignDetection>>(
            valueListenable: _detectionsNotifier,
            builder: (context, detections, _) {
              if (detections.isEmpty) return const SizedBox.shrink();
              return Stack(
                fit: StackFit.expand,
                children: [
                  DetectionOverlay(detections: detections),
                  Align(
                    alignment: Alignment.bottomCenter,
                    child: Padding(
                      padding: const EdgeInsets.all(12),
                      child: Wrap(
                        alignment: WrapAlignment.center,
                        spacing: 8,
                        runSpacing: 8,
                        children: detections
                            .map(
                              (d) => Container(
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 12,
                                  vertical: 8,
                                ),
                                decoration: BoxDecoration(
                                  color: d.color.withValues(alpha: 0.9),
                                  borderRadius: BorderRadius.circular(999),
                                ),
                                child: Text(
                                  '${d.label} ${d.percentScore}',
                                  style: const TextStyle(
                                    color: Colors.black,
                                    fontWeight: FontWeight.w700,
                                  ),
                                ),
                              ),
                            )
                            .toList(growable: false),
                      ),
                    ),
                  ),
                ],
              );
            },
          ),
      ],
    );
  }

  Widget _previewViewport({required Widget child}) {
    final previewSize = _camera?.value.previewSize;
    if (previewSize == null) return const SizedBox.expand();
    final portrait = MediaQuery.of(context).orientation == Orientation.portrait;
    final width = portrait ? previewSize.height : previewSize.width;
    final height = portrait ? previewSize.width : previewSize.height;
    return SizedBox.expand(
      child: ClipRect(
        child: Transform.scale(
          scale: _zoomScale,
          child: FittedBox(
            fit: BoxFit.cover,
            child: SizedBox(width: width, height: height, child: child),
          ),
        ),
      ),
    );
  }

  Widget _panel({
    required String label,
    required Widget child,
    required ViewMode mode,
  }) {
    return GestureDetector(
      onTap: () => setState(() => _viewMode = _viewMode == mode ? ViewMode.split : mode),
      child: ColoredBox(
        color: Colors.black,
        child: ClipRect(
          child: Stack(
            fit: StackFit.expand,
            children: [
              child,
              IgnorePointer(
                ignoring: !_overlayVisible,
                child: AnimatedOpacity(
                  opacity: _overlayVisible ? 1 : 0,
                  duration: const Duration(milliseconds: 250),
                  child: Align(
                    alignment: Alignment.topLeft,
                    child: Container(
                      margin: const EdgeInsets.all(12),
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                      decoration: BoxDecoration(
                        color: Colors.black54,
                        borderRadius: BorderRadius.circular(999),
                      ),
                      child: Text(
                        _viewMode == mode ? '$label - tap to restore' : '$label - tap to zoom',
                        style: const TextStyle(color: Colors.white),
                      ),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _topButton(IconData icon, FutureOr<void> Function() onPressed) {
    return Material(
      color: Colors.black54,
      borderRadius: BorderRadius.circular(14),
      child: IconButton(
        onPressed: () {
          _revealOverlay();
          final result = onPressed();
          if (result is Future) unawaited(result);
        },
        icon: Icon(icon, color: Colors.white),
      ),
    );
  }

  Widget _statusChip(String text) {
    return DecoratedBox(
      decoration: BoxDecoration(color: Colors.black54, borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        child: Text(
          text,
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(color: Colors.white),
        ),
      ),
    );
  }

  Widget _switchTile({
    required String label,
    required String subtitle,
    required bool value,
    required FutureOr<void> Function(bool)? onChanged,
  }) {
    return SwitchListTile(
      dense: true,
      contentPadding: const EdgeInsets.symmetric(horizontal: 8),
      title: Text(label, style: const TextStyle(color: Colors.white)),
      subtitle: Text(subtitle, style: const TextStyle(color: Colors.white70)),
      value: value,
      onChanged: onChanged == null
          ? null
          : (next) async {
              _revealOverlay();
              final result = onChanged(next);
              if (result is Future) await result;
            },
    );
  }
}

enum ViewMode { split, originalOnly, processedOnly }

enum ModelState { loading, ready, error }

class DetectionOverlay extends StatelessWidget {
  const DetectionOverlay({super.key, required this.detections});

  final List<RoadSignDetection> detections;

  @override
  Widget build(BuildContext context) {
    return IgnorePointer(
      child: LayoutBuilder(
        builder: (context, constraints) => Stack(
          children: detections
              .map(
                (d) => Positioned(
                  left: d.left * constraints.maxWidth,
                  top: d.top * constraints.maxHeight,
                  width: d.width * constraints.maxWidth,
                  height: d.height * constraints.maxHeight,
                  child: Container(
                    decoration: BoxDecoration(
                      border: Border.all(color: d.color, width: 3),
                      borderRadius: BorderRadius.circular(16),
                    ),
                    child: Align(
                      alignment: Alignment.topLeft,
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                        decoration: BoxDecoration(
                          color: d.color,
                          borderRadius: const BorderRadius.only(bottomRight: Radius.circular(14)),
                        ),
                        child: Text(
                          '${d.label} ${d.percentScore}',
                          style: const TextStyle(color: Colors.black, fontWeight: FontWeight.w800),
                        ),
                      ),
                    ),
                  ),
                ),
              )
              .toList(growable: false),
        ),
      ),
    );
  }
}

class RoadSignModelManifest {
  const RoadSignModelManifest({
    required this.modelFile,
    required this.inputWidth,
    required this.inputHeight,
    required this.inputType,
    required this.labels,
    required this.scoreThreshold,
    required this.iouThreshold,
  });

  factory RoadSignModelManifest.fromJson(Map<String, dynamic> json) {
    return RoadSignModelManifest(
      modelFile: json['modelFile'] as String,
      inputWidth: json['inputWidth'] as int,
      inputHeight: json['inputHeight'] as int,
      inputType: json['inputType'] as String? ?? 'float32',
      labels: (json['labels'] as List<dynamic>).cast<String>(),
      scoreThreshold: (json['scoreThreshold'] as num).toDouble(),
      iouThreshold: (json['iouThreshold'] as num).toDouble(),
    );
  }

  final String modelFile;
  final int inputWidth;
  final int inputHeight;
  final String inputType;
  final List<String> labels;
  final double scoreThreshold;
  final double iouThreshold;
}

class RoadSignDetection {
  const RoadSignDetection({
    required this.label,
    required this.score,
    required this.classIndex,
    required this.left,
    required this.top,
    required this.width,
    required this.height,
  });

  final String label;
  final double score;
  final int classIndex;
  final double left;
  final double top;
  final double width;
  final double height;

  Color get color => _overlayColors[classIndex % _overlayColors.length];
  String get percentScore => '${(score * 100).round()}%';
}

const _overlayColors = <Color>[
  Color(0xFFF7B500),
  Color(0xFF4DD6FF),
  Color(0xFF7BE495),
  Color(0xFFFFD166),
];

List<RoadSignDetection> _parseNativeDetections(
  List<dynamic>? rawDetections,
  RoadSignModelManifest manifest,
) {
  if (rawDetections == null || rawDetections.isEmpty) return const [];
  return rawDetections
      .whereType<Map<dynamic, dynamic>>()
      .map((raw) {
        final maxClassIndex = math.max(manifest.labels.length - 1, 0);
        final classIndex = math.min(
          math.max((raw['classIndex'] as num?)?.toInt() ?? 0, 0),
          maxClassIndex,
        );
        final fallbackLabel = manifest.labels.isEmpty ? 'Road sign' : manifest.labels[classIndex];
        return RoadSignDetection(
          label: raw['label'] as String? ?? fallbackLabel,
          score: (raw['score'] as num?)?.toDouble() ?? 0,
          classIndex: classIndex,
          left: ((raw['left'] as num?)?.toDouble() ?? 0).clamp(0.0, 1.0),
          top: ((raw['top'] as num?)?.toDouble() ?? 0).clamp(0.0, 1.0),
          width: ((raw['width'] as num?)?.toDouble() ?? 0).clamp(0.0, 1.0),
          height: ((raw['height'] as num?)?.toDouble() ?? 0).clamp(0.0, 1.0),
        );
      })
      .toList(growable: false);
}

bool _sameDetections(
  List<RoadSignDetection> a,
  List<RoadSignDetection> b,
) {
  if (identical(a, b)) return true;
  if (a.length != b.length) return false;
  for (var i = 0; i < a.length; i++) {
    final left = a[i];
    final right = b[i];
    if (left.label != right.label ||
        left.classIndex != right.classIndex ||
        (left.score - right.score).abs() > 0.01 ||
        (left.left - right.left).abs() > 0.01 ||
        (left.top - right.top).abs() > 0.01 ||
        (left.width - right.width).abs() > 0.01 ||
        (left.height - right.height).abs() > 0.01) {
      return false;
    }
  }
  return true;
}
