// Strings for the renderer UI (everything except the Settings screen, which
// lives in `settingsUi`). `en` defines the shape; `pt` must match it.

export const en = {
  common: {
    loading: 'Loading…',
    untitled: 'Untitled',
    cancel: 'Cancel',
    confirm: 'Confirm'
  },

  format: {
    lessThanOneMinute: 'less than 1 min',
    today: (time: string) => `today, ${time}`,
    yesterday: (time: string) => `yesterday, ${time}`
  },

  app: {
    status: {
      recording: 'recording',
      transcribing: 'transcribing',
      summarizing: 'writing summary',
      error: 'error'
    },
    backToRecording: 'Back to recording',
    newMeeting: 'New meeting',
    searchPlaceholder: 'Search meetings',
    noMeetingsYet: 'No meetings yet. Record your first one.',
    nothingFound: 'Nothing found.',
    settings: 'Settings',
    apiKeyMissing: 'API key not configured',
    suggestStart: {
      /** Rendered after the bold app names. */
      usingMic: ' is using the microphone. Record this meeting?',
      notNow: 'Not now',
      record: 'Record'
    },
    suggestStop: {
      message: 'No app is using the microphone anymore. Stop recording and write the summary?',
      keepRecording: 'Keep recording',
      stop: 'Stop'
    }
  },

  record: {
    missingKey: {
      title: 'OpenAI key missing',
      body: 'Yogurt records audio locally, but needs the OpenAI API to transcribe with Whisper and write the summary. Nothing is sent until you set up the key.',
      openSettings: 'Open settings'
    },
    start: {
      title: 'New meeting',
      body: 'Yogurt captures system audio (Teams, Meet, Zoom) and your microphone. You jot down what matters; the AI rebuilds the rest from the transcript.',
      titlePlaceholder: 'Title (optional — the AI suggests one at the end)',
      systemAudio: 'System audio',
      microphone: 'Microphone',
      change: 'change',
      startRecording: 'Start recording',
      dismiss: 'dismiss'
    },
    finishing: {
      title: 'Processing',
      body: 'Finishing transcribing the pending segments and writing the summary. It may take a while for long meetings.'
    },
    paused: 'paused',
    recording: 'recording',
    queued: (n: number) => ` · ${n} segment${n === 1 ? '' : 's'} queued`,
    skippedSilent: (n: number) => ` · ${n} silent, not transcribed`,
    meterMic: 'mic',
    meterSystem: 'system',
    resume: 'Resume',
    pause: 'Pause',
    stopAndSummarize: 'Stop and summarize',
    ok: 'ok',
    yourNotes: 'Your notes',
    notesHint: 'jot freely — the AI fills in from the transcript',
    notesPlaceholder:
      'Pedro will review the contract\ntight deadline?\ndecision: go with vendor B\n\nWhat you write here becomes the backbone of the summary.',
    transcript: 'Transcript',
    arrivesEvery: (minutes: number) => `arrives every ${minutes} min`,
    segmentsProgress: (done: number, sent: number) => `${done} of ${sent} segments`,
    firstChunk: (minutes: number) =>
      `The first excerpt appears once the initial ${minutes}-min segment closes and comes back from Whisper.`,
    follow: '↓ follow'
  },

  recorder: {
    systemUnavailable: (reason: string) =>
      `System audio unavailable — recording the microphone only. (${reason})`,
    systemEnded: 'System audio capture was interrupted. The microphone keeps recording.'
  },

  audio: {
    unsupported: 'This environment does not support audio recording via MediaRecorder.',
    micAccess: (reason: string) => `Could not access the microphone: ${reason}`,
    noSystemTrack: 'no system audio track was delivered',
    systemCapture: (reason: string) => `Could not capture system audio: ${reason}`,
    noSource: 'No audio source enabled. Turn on the microphone or system audio.'
  },

  meeting: {
    busy: {
      regenerate: 'Regenerating the summary…',
      retranscribe: 'Retranscribing…',
      audio: 'Removing the audio…',
      fallback: 'Processing…'
    },
    money: (usd: number, digits: number) => `$${usd.toFixed(digits)}`,
    upTo: (amount: string) => `up to ${amount}`,
    notesSaved: 'Notes saved. Use "Regenerate summary" to reflect the changes.',
    regenerate: {
      price: (known: boolean, amount: string) =>
        ` It costs ${known ? 'about' : 'at most'} ${amount}.`,
      title: 'Regenerate the summary?',
      message: (price: string) =>
        'The current summary is replaced by a new one, written from the transcript and your notes — including any speaker names you have assigned.' +
        price +
        ' The audio is not re-sent.',
      confirm: 'Regenerate'
    },
    retranscribe: {
      detail: (files: number, channels: number, amount: string) =>
        `That is ${files} audio file${files === 1 ? '' : 's'} across ${channels} channel${channels === 1 ? '' : 's'}, at an approximate cost of ${amount}.`,
      detailNoCost: 'All the audio on disk is re-sent.',
      title: 'Retranscribe this meeting?',
      message: (detail: string) =>
        `${detail} The current transcript and summary are replaced. Use it when transcription failed, came out incomplete, or to reprocess with different settings — it is not needed in normal use.`,
      confirm: 'Retranscribe'
    },
    clickToRename: 'Click to rename',
    excerpts: (n: number) => `${n} excerpt${n === 1 ? '' : 's'}`,
    viewDetails: 'View details',
    blocksIncomplete: (n: number) =>
      n === 1 ? '1 block of this meeting is incomplete.' : `${n} blocks of this meeting are incomplete.`,
    truncatedHint:
      'Reducing "Segment size" in Settings → Meeting and retranscribing recovers the lost excerpt.',
    transcribing: (done: number, total: number) => `Transcribing (${done}/${total} segments)…`,
    writingSummary: 'Writing the summary…',
    tabs: {
      summary: 'Summary',
      notes: 'Notes',
      transcript: 'Transcript',
      speakers: 'Speakers'
    },
    menu: {
      export: 'Export…',
      exported: 'Exported.',
      openFolder: 'Open folder',
      openFolderHint: 'audio, notes and transcript as files',
      regenerate: 'Regenerate summary',
      regenerateHint: 'rewrites from the text',
      retranscribe: 'Retranscribe',
      retranscribeHintCost: (amount: string) => `~${amount} · re-sends the audio`,
      retranscribeHint: 're-sends all the audio to the API',
      discardAudio: 'Discard audio',
      discardAudioHint: 'frees disk space, keeps the text',
      deleteMeeting: 'Delete meeting'
    },
    discardAudio: {
      title: 'Delete only the audio files?',
      message:
        'The summary, notes and transcript remain. But "Retranscribe" and voice reference extraction stop working for this meeting.',
      confirm: 'Delete audio',
      done: 'Audio removed.'
    },
    deleteMeeting: {
      title: 'Delete this meeting?',
      message: (title: string) =>
        `"${title}" and all its audio, notes, transcript and summary will be removed from disk. This cannot be undone.`,
      confirm: 'Delete meeting'
    },
    noSummary: 'No summary yet.',
    noSummaryUseRegenerate: 'Use "Regenerate summary" to create it.',
    noSummaryNothing: 'There is no transcript or notes to summarize.',
    notesHintView:
      'The time is the moment in the meeting when you wrote the line — it is what aligns the note with that part of the conversation.',
    notesHintEdit:
      'Editing here changes what the AI uses as the backbone of the summary. New lines get no time, because there is no moment to anchor them to.',
    edit: 'Edit',
    discard: 'Discard',
    saveNotes: 'Save notes',
    noNotes: 'No notes in this meeting.',
    noTranscript: 'No transcript. If the audio is still on disk, try "Retranscribe".'
  },

  dropdown: {
    moreActions: 'More actions'
  },

  errorBoundary: {
    title: 'Something broke in the interface',
    body: 'Your meetings, notes and transcripts are saved in files and were not affected. Reloading usually fixes it.',
    reload: 'Reload',
    openDataFolder: 'Open data folder'
  },

  mic: {
    tooShort: 'Measurement too short. Try again.',
    floorTitle: 'Measured noise floor',
    off: 'Microphone off',
    above: 'Above the cut-off — counts as speech',
    below: 'Below the cut-off — treated as silence',
    cut: 'cut-off',
    current: (db: number) => ` · current ${db} dB`,
    floor: (db: number) => ` · floor ${db} dB`,
    stopTest: 'Stop test',
    testMic: 'Test microphone',
    calibrateTitle: 'Measures silence, then your speech, and puts the cut-off between the two',
    calibrate: 'Calibrate',
    calibrating: 'Calibrating…',
    default: 'Default',
    phaseQuiet: 'Stay quiet — measuring the room noise.',
    phaseSpeech: 'Now speak normally, as you would in the meeting.',
    // The result sentences wrap numbers in <strong>, so they are split around them.
    resultOk: {
      noise: 'Noise at ',
      speech: ', your speech at ',
      cut: '. Cut-off set to ',
      end: ', with headroom on both sides.'
    },
    resultFail: {
      start: 'Could not separate your speech from the noise — measured ',
      noise: ' of noise and ',
      end: ' of speech, too small a difference. The cut-off was not changed. Check that the microphone is not muted, move closer to it, or reduce the room noise.'
    },
    help: {
      start:
        'Speak normally and watch the meter. The pink line is the cut-off: sound below it does not count as speech, and a whole segment without speech is not sent to the API — that is what avoids paying for silence and what keeps Whisper from making up text over noise. Ideally the cut-off sits above the ',
      floor: 'floor',
      end: ' (light mark) and well below your speech.'
    }
  }
}

export const pt: typeof en = {
  common: {
    loading: 'Carregando…',
    untitled: 'Sem título',
    cancel: 'Cancelar',
    confirm: 'Confirmar'
  },

  format: {
    lessThanOneMinute: 'menos de 1 min',
    today: (time: string) => `hoje, ${time}`,
    yesterday: (time: string) => `ontem, ${time}`
  },

  app: {
    status: {
      recording: 'gravando',
      transcribing: 'transcrevendo',
      summarizing: 'escrevendo a ata',
      error: 'erro'
    },
    backToRecording: 'Voltar à gravação',
    newMeeting: 'Nova reunião',
    searchPlaceholder: 'Buscar reuniões',
    noMeetingsYet: 'Nenhuma reunião ainda. Grave a primeira.',
    nothingFound: 'Nada encontrado.',
    settings: 'Configurações',
    apiKeyMissing: 'Chave da API não configurada',
    suggestStart: {
      usingMic: ' está usando o microfone. Gravar esta reunião?',
      notNow: 'Agora não',
      record: 'Gravar'
    },
    suggestStop: {
      message: 'Nenhum app está mais usando o microfone. Encerrar a gravação e gerar a ata?',
      keepRecording: 'Continuar gravando',
      stop: 'Encerrar'
    }
  },

  record: {
    missingKey: {
      title: 'Falta a chave da OpenAI',
      body: 'O Yogurt grava o áudio localmente, mas precisa da API da OpenAI para transcrever com o Whisper e escrever a ata. Nada é enviado antes de você configurar a chave.',
      openSettings: 'Abrir configurações'
    },
    start: {
      title: 'Nova reunião',
      body: 'O Yogurt captura o áudio do sistema (Teams, Meet, Zoom) e o seu microfone. Você anota o que importa; o resto a IA reconstrói a partir da transcrição.',
      titlePlaceholder: 'Título (opcional — a IA sugere um no final)',
      systemAudio: 'Áudio do sistema',
      microphone: 'Microfone',
      change: 'alterar',
      startRecording: 'Iniciar gravação',
      dismiss: 'dispensar'
    },
    finishing: {
      title: 'Processando',
      body: 'Terminando de transcrever os segmentos pendentes e escrevendo a ata. Pode levar algum tempo em reuniões longas.'
    },
    paused: 'pausado',
    recording: 'gravando',
    queued: (n: number) => ` · ${n} segmento(s) na fila`,
    skippedSilent: (n: number) => ` · ${n} em silêncio, não transcrito(s)`,
    meterMic: 'mic',
    meterSystem: 'sistema',
    resume: 'Retomar',
    pause: 'Pausar',
    stopAndSummarize: 'Encerrar e resumir',
    ok: 'ok',
    yourNotes: 'Suas notas',
    notesHint: 'anote solto — a IA completa com a transcrição',
    notesPlaceholder:
      'Pedro vai revisar o contrato\nprazo apertado?\ndecisão: seguir com o fornecedor B\n\nO que você escrever aqui vira o eixo da ata.',
    transcript: 'Transcrição',
    arrivesEvery: (minutes: number) => `chega a cada ${minutes} min`,
    segmentsProgress: (done: number, sent: number) => `${done} de ${sent} segmentos`,
    firstChunk: (minutes: number) =>
      `O primeiro trecho aparece quando o segmento inicial de ${minutes} min fechar e voltar do Whisper.`,
    follow: '↓ acompanhar'
  },

  recorder: {
    systemUnavailable: (reason: string) =>
      `Áudio do sistema indisponível — gravando só o microfone. (${reason})`,
    systemEnded: 'A captura do áudio do sistema foi interrompida. O microfone continua gravando.'
  },

  audio: {
    unsupported: 'Este ambiente não suporta gravação de áudio via MediaRecorder.',
    micAccess: (reason: string) => `Não foi possível acessar o microfone: ${reason}`,
    noSystemTrack: 'nenhuma faixa de áudio do sistema foi entregue',
    systemCapture: (reason: string) => `Não foi possível capturar o áudio do sistema: ${reason}`,
    noSource: 'Nenhuma fonte de áudio habilitada. Ative microfone ou áudio do sistema.'
  },

  meeting: {
    busy: {
      regenerate: 'Regerando a ata…',
      retranscribe: 'Retranscrevendo…',
      audio: 'Removendo o áudio…',
      fallback: 'Processando…'
    },
    money: (usd: number, digits: number) => `US$ ${usd.toFixed(digits).replace('.', ',')}`,
    upTo: (amount: string) => `até ${amount}`,
    notesSaved: 'Notas salvas. Use "Regerar ata" para refletir as mudanças.',
    regenerate: {
      price: (known: boolean, amount: string) =>
        ` Custa ${known ? 'aproximadamente' : 'no máximo'} ${amount}.`,
      title: 'Regerar a ata?',
      message: (price: string) =>
        'A ata atual é substituída por uma nova, escrita a partir da transcrição e das suas notas — incluindo nomes de falante que você tenha atribuído.' +
        price +
        ' O áudio não é reenviado.',
      confirm: 'Regerar'
    },
    retranscribe: {
      detail: (files: number, channels: number, amount: string) =>
        `São ${files} arquivo(s) de áudio em ${channels} canal(is), a um custo aproximado de ${amount}.`,
      detailNoCost: 'Todo o áudio em disco é reenviado.',
      title: 'Retranscrever esta reunião?',
      message: (detail: string) =>
        `${detail} A transcrição e a ata atuais são substituídas. Use quando a transcrição falhou, ficou incompleta, ou para reprocessar com outra configuração — não é necessário no uso normal.`,
      confirm: 'Retranscrever'
    },
    clickToRename: 'Clique para renomear',
    excerpts: (n: number) => `${n} trechos`,
    viewDetails: 'Ver detalhes',
    blocksIncomplete: (n: number) =>
      n === 1 ? '1 bloco desta reunião ficou incompleto.' : `${n} blocos desta reunião ficaram incompletos.`,
    truncatedHint:
      'Reduzir "Tamanho do segmento" em Configurações → Reunião e retranscrever recupera o trecho perdido.',
    transcribing: (done: number, total: number) => `Transcrevendo (${done}/${total} segmentos)…`,
    writingSummary: 'Escrevendo a ata…',
    tabs: {
      summary: 'Ata',
      notes: 'Notas',
      transcript: 'Transcrição',
      speakers: 'Falantes'
    },
    menu: {
      export: 'Exportar…',
      exported: 'Exportado.',
      openFolder: 'Abrir pasta',
      openFolderHint: 'áudio, notas e transcrição em arquivos',
      regenerate: 'Regerar ata',
      regenerateHint: 'reescreve a partir do texto',
      retranscribe: 'Retranscrever',
      retranscribeHintCost: (amount: string) => `~${amount} · reenvia o áudio`,
      retranscribeHint: 'reenvia todo o áudio à API',
      discardAudio: 'Descartar áudio',
      discardAudioHint: 'libera disco, mantém o texto',
      deleteMeeting: 'Apagar reunião'
    },
    discardAudio: {
      title: 'Apagar só os arquivos de áudio?',
      message:
        'A ata, as notas e a transcrição continuam. Mas "Retranscrever" e a extração de referências de voz deixam de funcionar nesta reunião.',
      confirm: 'Apagar áudio',
      done: 'Áudio removido.'
    },
    deleteMeeting: {
      title: 'Apagar esta reunião?',
      message: (title: string) =>
        `"${title}" e todo o áudio, notas, transcrição e ata serão removidos do disco. Não há como desfazer.`,
      confirm: 'Apagar reunião'
    },
    noSummary: 'Ainda não há ata.',
    noSummaryUseRegenerate: 'Use "Regerar ata" para criá-la.',
    noSummaryNothing: 'Não há transcrição nem notas para resumir.',
    notesHintView:
      'O horário é o instante da reunião em que você escreveu a linha — é o que alinha a nota ao trecho da conversa.',
    notesHintEdit:
      'Editar aqui muda o que a IA usa como eixo da ata. Linhas novas ficam sem horário, porque não há instante ao qual ancorá-las.',
    edit: 'Editar',
    discard: 'Descartar',
    saveNotes: 'Salvar notas',
    noNotes: 'Nenhuma nota nesta reunião.',
    noTranscript: 'Sem transcrição. Se o áudio ainda estiver em disco, tente "Retranscrever".'
  },

  dropdown: {
    moreActions: 'Mais ações'
  },

  errorBoundary: {
    title: 'Algo quebrou na interface',
    body: 'Suas reuniões, notas e transcrições estão salvas em arquivos e não foram afetadas. Recarregar costuma resolver.',
    reload: 'Recarregar',
    openDataFolder: 'Abrir pasta de dados'
  },

  mic: {
    tooShort: 'Medição curta demais. Tente de novo.',
    floorTitle: 'Piso de ruído medido',
    off: 'Microfone desligado',
    above: 'Acima do corte — conta como fala',
    below: 'Abaixo do corte — tratado como silêncio',
    cut: 'corte',
    current: (db: number) => ` · atual ${db} dB`,
    floor: (db: number) => ` · piso ${db} dB`,
    stopTest: 'Parar teste',
    testMic: 'Testar microfone',
    calibrateTitle: 'Mede o silêncio, depois a sua fala, e põe o corte entre os dois',
    calibrate: 'Calibrar',
    calibrating: 'Calibrando…',
    default: 'Padrão',
    phaseQuiet: 'Fique em silêncio — medindo o ruído do ambiente.',
    phaseSpeech: 'Agora fale normalmente, como falaria na reunião.',
    resultOk: {
      noise: 'Ruído em ',
      speech: ', sua fala em ',
      cut: '. Corte ajustado para ',
      end: ', com folga para os dois lados.'
    },
    resultFail: {
      start: 'Não deu para separar sua fala do ruído — medi ',
      noise: ' de ruído e ',
      end: ' de fala, diferença pequena demais. O corte não foi alterado. Verifique se o microfone não está mutado, aproxime-se dele, ou reduza o ruído do ambiente.'
    },
    help: {
      start:
        'Fale normalmente e veja o medidor. A linha rosa é o corte: som abaixo dela não conta como fala, e um segmento inteiro sem fala não é enviado à API — é o que evita pagar por silêncio e o que impede o Whisper de inventar texto sobre ruído. O ideal é o corte ficar acima do ',
      floor: 'piso',
      end: ' (traço claro) e bem abaixo da sua fala.'
    }
  }
}
