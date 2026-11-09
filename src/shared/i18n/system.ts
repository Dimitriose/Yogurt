// Strings for this namespace. `en` defines the shape; `pt` must match it.
//
// "System" covers what the OS shows on the app's behalf (tray, native dialogs,
// notifications) plus the model catalog labels in `shared/models.ts`.
export const en = {
  speakers: {
    me: 'Me',
    others: 'Others'
  },
  tray: {
    idle: 'No recording in progress',
    paused: (clock: string) => `Paused · ${clock}`,
    recording: (clock: string) => `Recording · ${clock}`,
    open: 'Open Yogurt',
    quit: 'Quit Yogurt',
    hintTitle: 'Yogurt is still running',
    hintBody:
      'It stays here in the tray, and any recording in progress keeps going. To quit for good, right-click the icon and choose "Quit Yogurt".'
  },
  dialogs: {
    discardRecording: {
      keepRecording: 'Keep recording',
      discardAndQuit: 'Discard and quit',
      title: 'Recording in progress',
      message: 'A meeting is being recorded.',
      detail:
        'Quitting now loses the part that has not been closed yet. Finished segments stay on disk and can be processed later with "Retranscribe".'
    }
  },
  notifications: {
    meetingStarting: {
      title: 'Meeting starting?',
      body: (apps: string) => `${apps} is using the microphone. Click to record with Yogurt.`
    },
    meetingEnded: {
      title: 'Did the meeting end?',
      body: 'No app is using the microphone anymore. Click to stop and generate the minutes.'
    }
  },
  models: {
    luna: 'gpt-5.6-luna (higher TPM, cheaper)',
    gpt4o: 'gpt-4o (30k TPM — fails on long meetings)',
    gpt4oMini: 'gpt-4o-mini (cheap)'
  },
  store: {
    invalidMeetingId: (id: string) => `Invalid meeting ID: ${id}`,
    invalidSegmentIndex: (index: number) => `Invalid segment index: ${index}`,
    invalidAudioChannel: (source: string) => `Invalid audio channel: ${source}`
  }
}

export const pt: typeof en = {
  speakers: {
    me: 'Eu',
    others: 'Outros'
  },
  tray: {
    idle: 'Nenhuma gravação em curso',
    paused: (clock) => `Pausado · ${clock}`,
    recording: (clock) => `Gravando · ${clock}`,
    open: 'Abrir Yogurt',
    quit: 'Sair do Yogurt',
    hintTitle: 'O Yogurt continua aberto',
    hintBody:
      'Ele fica aqui na bandeja, e a gravação em curso não é interrompida. Para fechar de vez, clique com o botão direito no ícone e escolha "Sair do Yogurt".'
  },
  dialogs: {
    discardRecording: {
      keepRecording: 'Continuar gravando',
      discardAndQuit: 'Descartar e sair',
      title: 'Gravação em andamento',
      message: 'Há uma reunião sendo gravada.',
      detail:
        'Sair agora perde o trecho ainda não fechado. Os segmentos já concluídos ficam em disco e podem ser processados depois com "Retranscrever".'
    }
  },
  notifications: {
    meetingStarting: {
      title: 'Reunião começando?',
      body: (apps) => `${apps} está usando o microfone. Clique para gravar com o Yogurt.`
    },
    meetingEnded: {
      title: 'A reunião terminou?',
      body: 'Nenhum app está mais usando o microfone. Clique para encerrar e gerar a ata.'
    }
  },
  models: {
    luna: 'gpt-5.6-luna (mais TPM, mais barato)',
    gpt4o: 'gpt-4o (30k TPM — falha em reunião longa)',
    gpt4oMini: 'gpt-4o-mini (barato)'
  },
  store: {
    invalidMeetingId: (id) => `ID de reunião inválido: ${id}`,
    invalidSegmentIndex: (index) => `Índice de segmento inválido: ${index}`,
    invalidAudioChannel: (source) => `Canal de áudio inválido: ${source}`
  }
}
