/* Continuous audio-thread metering; source stays silent at the output. */
import './meter-ballistics.js';

class AVProMeterProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.meter = new globalThis.AVMeterDSP.PCMStreamMeter(sampleRate, options.processorOptions?.ballistics || {});
    this.framesSincePost = 0;
    this.postFrames = Math.max(128, Math.round(sampleRate / 100));
    this.port.onmessage = event => {
      if (event.data?.type === 'configure') {
        try { this.meter.configure(event.data.options); }
        catch (error) { this.port.postMessage({ type: 'configuration-error', message: error.message }); }
      }
    };
  }
  process(inputs, outputs) {
    const input = inputs[0];
    // Avoid any feedback/monitoring even if a platform provides output buffers.
    for (const output of outputs) for (const channel of output) channel.fill(0);
    if (input?.[0]?.length) {
      this.meter.process(input[0], input[1]);
      this.framesSincePost += input[0].length;
      if (this.framesSincePost >= this.postFrames) {
        this.framesSincePost %= this.postFrames;
        this.port.postMessage({ type: 'measurement', ...this.meter.snapshot() });
      }
    }
    return true;
  }
}
registerProcessor('avpro-continuous-meter-v1', AVProMeterProcessor);
