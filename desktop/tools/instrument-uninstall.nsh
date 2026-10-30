; The current-user login entry belongs only to this instrument.
!macro customUnInstall
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "AudioVisualizerProInstrument"
!macroend
