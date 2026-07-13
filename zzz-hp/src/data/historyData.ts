import type { ModeKey, PhaseData } from '@/types/history'

const crisisAssaultPhases: PhaseData[] = [
  {
    id: 'ca-1-4-1',
    version: '1.4',
    phase: '第 1 期',
    dateRange: '2026/01/14 - 2026/02/11',
    tid: '69001',
    rawHp: '54,194,949',
    buffs: [
      {
        name: '灵破',
        icon: '⚡',
        lines: [
          '代理人触发属性异常时，全队暴击率提升 15%，持续 8 秒。',
          '暴击伤害提升 30%，可叠加 3 层。',
        ],
      },
      {
        name: '迅决',
        icon: '💨',
        lines: [
          '代理人发动连携技后，全队攻击力提升 20%，持续 10 秒。',
          '连携技伤害提升 25%。',
        ],
      },
      {
        name: '打断',
        icon: '🔥',
        lines: [
          '代理人触发失衡时，敌人全属性抗性降低 20%，持续 12 秒。',
          '对失衡敌人造成的伤害提升 15%。',
        ],
      },
    ],
    enemies: [
      {
        label: '房间 1 Lv70',
        subStats: 'HP: 170% | 失衡: 100% | 异常: 100%',
        hp: '8,234,567',
        altHp: '8,234,567',
        elements: ['⚡', '🔥'],
      },
      {
        label: '房间 2 Lv75',
        subStats: 'HP: 200% | 失衡: 120% | 异常: 110%',
        hp: '12,456,789',
        altHp: '12,456,789',
        elements: ['❄️', '⚡'],
        footer: 'Boss 伤害抗性 40%',
      },
      {
        label: '房间 3 Lv70',
        subStats: 'HP: 170% | 失衡: 100% | 异常: 100%',
        hp: '9,876,543',
        altHp: '9,876,543',
        elements: ['🔥', '💨'],
      },
    ],
  },
  {
    id: 'ca-1-3-2',
    version: '1.3',
    phase: '第 2 期',
    dateRange: '2025/12/10 - 2026/01/07',
    tid: '69002',
    rawHp: '48,320,100',
    buffs: [
      {
        name: '强袭',
        icon: '⚔️',
        lines: ['代理人普通攻击伤害提升 25%。', '命中敌人后，攻击速度提升 10%，持续 6 秒。'],
      },
      {
        name: '庇护',
        icon: '🛡️',
        lines: ['代理人发动闪避反击后，全队受到伤害降低 15%，持续 8 秒。', '护盾效果提升 20%。'],
      },
      {
        name: '共鸣',
        icon: '✨',
        lines: ['代理人发动终结技后，全队能量回复效率提升 30%。', '终结技伤害提升 20%。'],
      },
    ],
    enemies: [
      {
        label: '房间 1 Lv68',
        subStats: 'HP: 160% | 失衡: 95% | 异常: 95%',
        hp: '7,100,000',
        altHp: '7,100,000',
        elements: ['🔥'],
      },
      {
        label: '房间 2 Lv72',
        subStats: 'HP: 185% | 失衡: 110% | 异常: 105%',
        hp: '10,800,000',
        altHp: '10,800,000',
        elements: ['⚡', '❄️'],
        footer: 'Boss 伤害抗性 35%',
      },
      {
        label: '房间 3 Lv68',
        subStats: 'HP: 160% | 失衡: 95% | 异常: 95%',
        hp: '7,500,000',
        altHp: '7,500,000',
        elements: ['💨'],
      },
    ],
  },
]

const defensePhases: PhaseData[] = [
  {
    id: 'df-1-4-1',
    version: '1.4',
    phase: '第 1 期',
    dateRange: '2026/01/21 - 2026/02/18',
    tid: '69003',
    rawHp: '62,500,000',
    buffs: [
      {
        name: '坚守',
        icon: '🛡️',
        lines: ['代理人生命值低于 50% 时，防御力提升 40%。', '受到的伤害降低 20%。'],
      },
      {
        name: '反击',
        icon: '⚔️',
        lines: ['代理人受击后，下次攻击伤害提升 35%。', '反击窗口延长 1 秒。'],
      },
      {
        name: '协防',
        icon: '🤝',
        lines: ['切换代理人时，新上场代理人获得 15 秒护盾。', '护盾吸收量提升 25%。'],
      },
    ],
    enemies: [
      {
        label: 'Wave 1 Lv65',
        subStats: 'HP: 150% | 失衡: 90% | 异常: 90%',
        hp: '5,600,000',
        altHp: '5,600,000',
        elements: ['🔥', '⚡'],
      },
      {
        label: 'Wave 2 Lv70',
        subStats: 'HP: 175% | 失衡: 105% | 异常: 100%',
        hp: '8,900,000',
        altHp: '8,900,000',
        elements: ['❄️'],
        footer: 'Boss 伤害抗性 30%',
      },
      {
        label: 'Wave 3 Lv65',
        subStats: 'HP: 150% | 失衡: 90% | 异常: 90%',
        hp: '6,200,000',
        altHp: '6,200,000',
        elements: ['💨', '🔥'],
      },
    ],
  },
]

const deductionPhases: PhaseData[] = [
  {
    id: 'dd-1-4-1',
    version: '1.4',
    phase: '第 1 期',
    dateRange: '2026/02/01 - 2026/02/28',
    tid: '69004',
    rawHp: '38,750,000',
    buffs: [
      {
        name: '推演',
        icon: '🧠',
        lines: ['战斗开始时，随机获得 1 个额外增益效果。', '增益持续时间延长 50%。'],
      },
      {
        name: '临界',
        icon: '⚠️',
        lines: ['代理人生命值低于 30% 时，全属性伤害提升 50%。', '治疗效果降低 50%。'],
      },
      {
        name: '极限',
        icon: '💥',
        lines: ['每次击败敌人，全队攻击力永久提升 3%（最多 10 层）。', '层数达到上限后，暴击率额外提升 20%。'],
      },
    ],
    enemies: [
      {
        label: 'Node A Lv72',
        subStats: 'HP: 180% | 失衡: 110% | 异常: 105%',
        hp: '9,500,000',
        altHp: '9,500,000',
        elements: ['⚡'],
      },
      {
        label: 'Node B Lv75',
        subStats: 'HP: 210% | 失衡: 125% | 异常: 115%',
        hp: '14,200,000',
        altHp: '14,200,000',
        elements: ['🔥', '❄️'],
        footer: 'Boss 伤害抗性 45%',
      },
      {
        label: 'Node C Lv72',
        subStats: 'HP: 180% | 失衡: 110% | 异常: 105%',
        hp: '10,100,000',
        altHp: '10,100,000',
        elements: ['💨', '⚡'],
      },
    ],
  },
]

export const historyData: Record<ModeKey, PhaseData[]> = {
  'crisis-assault': crisisAssaultPhases,
  defense: defensePhases,
  deduction: deductionPhases,
}
