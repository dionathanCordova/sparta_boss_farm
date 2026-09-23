const SERVER_CHOICES = [
  { name: "Server 1", value: "Server 1" },
  { name: "Server 2", value: "Server 2" },
  { name: "Server 3", value: "Server 3" },
];

export const COMMANDS = [
  {
    name: "proximos",
    description: "Mostra os 20 bosses mais próximos de nascer, em todos os servers",
    type: 1,
  },
  {
    name: "bosses",
    description: "Lista os bosses de um server com o tempo até nascer",
    type: 1,
    options: [
      {
        type: 3,
        name: "server",
        description: "Qual server",
        required: true,
        choices: SERVER_CHOICES,
      },
    ],
  },
  {
    name: "respawn",
    description: "Define o tempo de respawn de um boss (igual clicar em 'definir respawn' no site)",
    type: 1,
    options: [
      {
        type: 3,
        name: "server",
        description: "Qual server",
        required: true,
        choices: SERVER_CHOICES,
      },
      {
        type: 3,
        name: "boss",
        description: "Qual boss (comece a digitar pra ver as opções)",
        required: true,
        autocomplete: true,
      },
      {
        type: 3,
        name: "tempo",
        description: "Tempo até nascer: 3:11 (3h11) ou 45 (45 min)",
        required: true,
      },
    ],
  },
];
