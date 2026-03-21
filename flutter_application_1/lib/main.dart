import 'dart:async';

import 'package:camera/camera.dart';
import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';
import 'package:flutter_shaders/flutter_shaders.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(ColorAssistApp(cameras: await availableCameras()));
}

class ColorAssistApp extends StatelessWidget {
  const ColorAssistApp({super.key, required this.cameras});

  final List<CameraDescription> cameras;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Color Assist',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(colorScheme: ColorScheme.fromSeed(seedColor: Colors.teal)),
      home: ColorAssistScreen(cameras: cameras),
    );
  }
}

class ColorAssistScreen extends StatefulWidget {
  const ColorAssistScreen({super.key, required this.cameras});

  final List<CameraDescription> cameras;

  @override
  State<ColorAssistScreen> createState() => _ColorAssistScreenState();
}

class _ColorAssistScreenState extends State<ColorAssistScreen>
    with SingleTickerProviderStateMixin {
  static const _overlayTimeout = Duration(seconds: 3);

  CameraController? _camera;
  late final Ticker _previewTicker;
  Timer? _overlayTimer;
  int _cameraIndex = 0;

  bool _swapRedBlue = true;
  bool _yellowToCyan = true;
  bool _showControls = false;
  bool _overlayVisible = true;
  String _status = 'Initializing camera...';
  _ViewMode _viewMode = _ViewMode.split;
  double _zoomScale = 1.0;
  double _zoomStartScale = 1.0;

  @override
  void initState() {
    super.initState();
    final preferredIndex = widget.cameras.indexWhere(
      (camera) => camera.lensDirection == CameraLensDirection.back,
    );
    if (preferredIndex >= 0) {
      _cameraIndex = preferredIndex;
    }
    _previewTicker = createTicker((_) {
      if (!mounted || _camera == null || !_camera!.value.isInitialized) {
        return;
      }
      setState(() {});
    })..start();
    unawaited(_startCamera());
  }

  @override
  void dispose() {
    _previewTicker.dispose();
    _overlayTimer?.cancel();
    unawaited(_camera?.dispose());
    super.dispose();
  }

  Future<void> _startCamera() async {
    if (widget.cameras.isEmpty) {
      setState(() => _status = 'No camera detected on this device.');
      return;
    }

    final safeIndex = _cameraIndex.clamp(0, widget.cameras.length - 1);
    final description = widget.cameras[safeIndex];

    final camera = CameraController(
      description,
      ResolutionPreset.medium,
      enableAudio: false,
    );

    try {
      await camera.initialize();
      if (!mounted) {
        await camera.dispose();
        return;
      }

      setState(() {
        _camera = camera;
        _status = '';
      });
      _revealOverlay();
    } catch (error) {
      await camera.dispose();
      if (mounted) {
        setState(() => _status = 'Camera initialization failed: $error');
      }
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
    });
    await previous?.dispose();
    await _startCamera();
  }

  void _revealOverlay() {
    _overlayTimer?.cancel();
    if (mounted) {
      setState(() => _overlayVisible = true);
    }
    _overlayTimer = Timer(_overlayTimeout, () {
      if (mounted && !_showControls) {
        setState(() {
          _overlayVisible = false;
        });
      }
    });
  }

  void _toggleControls() {
    _revealOverlay();
    setState(() => _showControls = !_showControls);
  }

  void _setViewMode(_ViewMode mode) {
    _revealOverlay();
    setState(() => _viewMode = _viewMode == mode ? _ViewMode.split : mode);
  }

  @override
  Widget build(BuildContext context) {
    final camera = _camera;
    final previewReady = camera != null && camera.value.isInitialized;

    return Scaffold(
      body: SafeArea(
        child: GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTap: _revealOverlay,
          onScaleStart: (_) => _zoomStartScale = _zoomScale,
          onScaleUpdate: (details) {
            final nextScale = (_zoomStartScale * details.scale).clamp(1.0, 4.0);
            if (nextScale != _zoomScale) {
              setState(() => _zoomScale = nextScale);
            }
          },
          child: Stack(
            children: [
              Positioned.fill(
                child: previewReady
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
                              if (_status.isNotEmpty)
                                Expanded(
                                  child: DecoratedBox(
                                    decoration: BoxDecoration(
                                      color: Colors.black54,
                                      borderRadius: BorderRadius.circular(12),
                                    ),
                                    child: Padding(
                                      padding: const EdgeInsets.symmetric(
                                        horizontal: 12,
                                        vertical: 10,
                                      ),
                                      child: Text(
                                        _status,
                                        style: const TextStyle(color: Colors.white),
                                        maxLines: 2,
                                        overflow: TextOverflow.ellipsis,
                                      ),
                                    ),
                                  ),
                                ),
                              if (_status.isNotEmpty) const SizedBox(width: 12),
                              Material(
                                color: Colors.black54,
                                borderRadius: BorderRadius.circular(14),
                                child: IconButton(
                                  onPressed: _flipCamera,
                                  icon: const Icon(
                                    Icons.cameraswitch,
                                    color: Colors.white,
                                  ),
                                ),
                              ),
                              const SizedBox(width: 12),
                              Material(
                                color: Colors.black54,
                                borderRadius: BorderRadius.circular(14),
                                child: IconButton(
                                  onPressed: _toggleControls,
                                  icon: Icon(
                                    _showControls ? Icons.close : Icons.tune,
                                    color: Colors.white,
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                        if (_showControls)
                          Positioned(
                            top: 80,
                            right: 16,
                            child: ConstrainedBox(
                              constraints: const BoxConstraints(maxWidth: 320),
                              child: Material(
                                color: Colors.black87,
                                borderRadius: BorderRadius.circular(18),
                                child: Padding(
                                  padding: const EdgeInsets.all(12),
                                  child: Column(
                                    mainAxisSize: MainAxisSize.min,
                                    children: [
                                      SwitchListTile(
                                        dense: true,
                                        contentPadding: const EdgeInsets.symmetric(
                                          horizontal: 8,
                                        ),
                                        title: const Text(
                                          'Swap red and blue',
                                          style: TextStyle(color: Colors.white),
                                        ),
                                        subtitle: const Text(
                                          'Swaps red and blue for significantly saturated objects',
                                          style: TextStyle(color: Colors.white70),
                                        ),
                                        value: _swapRedBlue,
                                        onChanged: (value) {
                                          _revealOverlay();
                                          setState(() => _swapRedBlue = value);
                                        },
                                      ),
                                      SwitchListTile(
                                        dense: true,
                                        contentPadding: const EdgeInsets.symmetric(
                                          horizontal: 8,
                                        ),
                                        title: const Text(
                                          'Shift yellow to cyan',
                                          style: TextStyle(color: Colors.white),
                                        ),
                                        subtitle: const Text(
                                          'Swaps yellow to cyan (one-way) for significantly saturated objects',
                                          style: TextStyle(color: Colors.white70),
                                        ),
                                        value: _yellowToCyan,
                                        onChanged: (value) {
                                          _revealOverlay();
                                          setState(() => _yellowToCyan = value);
                                        },
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
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildPreviewArea() {
    final originalPanel = _panel(
      label: 'Original',
      mode: _ViewMode.originalOnly,
      child: _previewSurface(processed: false),
    );
    final processedPanel = _panel(
      label: 'Color Assist',
      mode: _ViewMode.processedOnly,
      child: _previewSurface(processed: true),
    );

    switch (_viewMode) {
      case _ViewMode.originalOnly:
        return originalPanel;
      case _ViewMode.processedOnly:
        return processedPanel;
      case _ViewMode.split:
        return Column(
          children: [
            Expanded(child: originalPanel),
            const SizedBox(height: 2),
            Expanded(child: processedPanel),
          ],
        );
    }
  }

  Widget _previewSurface({required bool processed}) {
    final camera = _camera;
    if (camera == null) {
      return const SizedBox.shrink();
    }

    final preview = _previewViewport(child: CameraPreview(camera));
    if (!processed) {
      return preview;
    }

    return ShaderBuilder(
      assetKey: 'shaders/color_assist.frag',
      child: preview,
      (context, shader, child) {
        return AnimatedSampler(
          enabled: _swapRedBlue || _yellowToCyan,
          child: child!,
          (image, size, canvas) {
            shader
              ..setFloat(0, size.width)
              ..setFloat(1, size.height)
              ..setFloat(2, _swapRedBlue ? 1.0 : 0.0)
              ..setFloat(3, _yellowToCyan ? 1.0 : 0.0)
              ..setImageSampler(0, image);
            canvas.drawRect(Offset.zero & size, Paint()..shader = shader);
          },
        );
      },
    );
  }

  Widget _previewViewport({required Widget child}) {
    final previewSize = _camera?.value.previewSize;
    if (previewSize == null) {
      return const SizedBox.expand();
    }

    final media = MediaQuery.of(context);
    final portrait = media.orientation == Orientation.portrait;
    final width = portrait ? previewSize.height : previewSize.width;
    final height = portrait ? previewSize.width : previewSize.height;

    return SizedBox.expand(
      child: ClipRect(
        child: Transform.scale(
          scale: _zoomScale,
          child: FittedBox(
            fit: BoxFit.cover,
            child: SizedBox(
              width: width,
              height: height,
              child: child,
            ),
          ),
        ),
      ),
    );
  }

  Widget _panel({
    required String label,
    required Widget child,
    required _ViewMode mode,
  }) {
    return GestureDetector(
      onTap: () => _setViewMode(mode),
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
}

enum _ViewMode { split, originalOnly, processedOnly }
