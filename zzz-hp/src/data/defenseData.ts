import type { DefenseSeason, DefenseVariant } from '@/types/defense'

const newDefenseSeasons: DefenseSeason[] = [
  {
    id: 'sd-3-0-1',
    version: '3.0',
    phase: '第 1 期',
    dateRange: '2026.6.26 - 2026.7.10',
    seasonId: '62051',
    nodeType: '剧变节点',
    rawHp: '130,224,902',
    aoeHp: '114,867,325',
    altHp: '100,999,801',
    totalHp: 130224902,
    frontiers: [
      {
        id: '6205105',
        title: '第五防线',
        level: 70,
        rooms: [
          {
            id: '62051051',
            label: '房间 1',
            level: 70,
            rankRequirements: { s: '25,000', a: '16,000', b: '8,000' },
            zoneBuffs: [
              '本关卡中，对敌人造成伤害可获得伤害分数；击败普通/精英敌人可获得击破分数。',
              '本关卡中，不同时间段获得的分数会获得额外倍率加成，挑战越早倍率越高，总分上限（含加成）为 50,000。',
            ],
            roomBuff: {
              name: '霜冻风暴',
              lines: [
                '代理人风属性与冰属性伤害提升 30%，涡流伤害提升 30%。',
                '代理人发动强化特殊技后，异常精通提升 40，持续 15 秒，重复触发刷新持续时间。',
              ],
            },
            battleRooms: [
              {
                id: '62051051-br1',
                label: '战斗房间 1',
                waveCount: 3,
                weakness: ['物理', '风'],
                waves: [
                  {
                    label: 'WAVE 1',
                    enemies: [
                      {
                        name: '特种抗暴布',
                        count: 3,
                        hp: '1,423,183',
                        hpValue: 1423183,
                        defense: 683,
                      },
                    ],
                  },
                  {
                    label: 'WAVE 2',
                    enemies: [
                      {
                        name: '城市守卫布',
                        hp: '8,311,482',
                        hpValue: 8311482,
                        defense: 858,
                      },
                      {
                        name: '空域巡逻布',
                        count: 2,
                        hp: '1,423,183',
                        hpValue: 1423183,
                        defense: 683,
                      },
                    ],
                  },
                  {
                    label: 'WAVE 3',
                    enemies: [
                      {
                        name: '秽息妖鬼·深渊执法者',
                        hp: '30,921,349',
                        hpValue: 30921349,
                        defense: 953,
                        isBoss: true,
                      },
                    ],
                  },
                ],
              },
            ],
          },
          {
            id: '62051052',
            label: '房间 2',
            level: 70,
            rankRequirements: { s: '25,000', a: '16,000', b: '8,000' },
            zoneBuffs: [
              '本关卡中，对敌人造成伤害可获得伤害分数；击败普通/精英敌人可获得击破分数。',
              '本关卡中，不同时间段获得的分数会获得额外倍率加成。',
            ],
            roomBuff: {
              name: '虚空侵蚀',
              lines: [
                '代理人以太伤害提升 30%，暴击伤害提升 40%。',
                '强攻代理人暴击命中后，敌人防御降低 10%，持续 5 秒，重复触发刷新持续时间。',
              ],
            },
            battleRooms: [
              {
                id: '62051052-br1',
                label: '战斗房间 1',
                waveCount: 3,
                weakness: ['物理', '以太'],
                waves: [
                  {
                    label: 'WAVE 1',
                    enemies: [
                      {
                        name: '私营猎兵',
                        count: 3,
                        hp: '817,045',
                        hpValue: 817045,
                        defense: 636,
                      },
                    ],
                  },
                  {
                    label: 'WAVE 2',
                    enemies: [
                      {
                        name: '卫士 MK II',
                        hp: '5,631,837',
                        hpValue: 5631837,
                        defense: 858,
                      },
                      {
                        name: '拆迁猎兵',
                        count: 2,
                        hp: '898,571',
                        hpValue: 898571,
                        defense: 636,
                      },
                    ],
                  },
                  {
                    label: 'WAVE 3',
                    enemies: [
                      {
                        name: '幻影射手单元',
                        hp: '39,537,115',
                        hpValue: 39537115,
                        defense: 953,
                        isBoss: true,
                      },
                    ],
                  },
                ],
              },
            ],
          },
          {
            id: '62051053',
            label: '房间 3',
            level: 70,
            rankRequirements: { s: '25,000', a: '16,000', b: '8,000' },
            zoneBuffs: [
              '本关卡中，对敌人造成伤害可获得伤害分数；击败普通/精英敌人可获得击破分数。',
            ],
            roomBuff: {
              name: '枢机锻造',
              lines: [
                '代理人以太与冰属性异常积蓄效率提升 25%。',
                '代理人触发属性异常后，敌人防御降低 10%，受到的属性异常伤害提升 20%，持续 10 秒。',
              ],
            },
            battleRooms: [
              {
                id: '62051053-br1',
                label: '战斗房间 1',
                waveCount: 2,
                weakness: ['冰'],
                waves: [
                  {
                    label: 'WAVE 1',
                    enemies: [
                      {
                        name: '拉赫穆',
                        hp: '6,233,612',
                        hpValue: 6233612,
                        defense: 715,
                      },
                      {
                        name: '穆修素',
                        hp: '6,233,612',
                        hpValue: 6233612,
                        defense: 715,
                      },
                    ],
                  },
                  {
                    label: 'WAVE 2',
                    enemies: [
                      {
                        name: '秽息妖鬼·狛野真仁',
                        hp: '21,991,702',
                        hpValue: 21991702,
                        defense: 953,
                        isBoss: true,
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        id: '6205104',
        title: '第四防线',
        level: 65,
        rooms: [
          {
            id: '62051041',
            label: '房间 1',
            level: 65,
            zoneBuffs: ['代理人风属性与冰属性伤害提升 30%。'],
            roomBuff: {
              name: '霜冻风暴',
              lines: ['代理人发动强化特殊技后，异常精通提升 40，持续 15 秒。'],
            },
            battleRooms: [
              {
                id: '62051041-br1',
                label: '战斗房间 1',
                waveCount: 2,
                weakness: ['电', '风'],
                waves: [
                  {
                    label: 'WAVE 1',
                    enemies: [
                      {
                        name: '城市守卫布',
                        hp: '5,969,380',
                        hpValue: 5969380,
                        defense: 857,
                      },
                    ],
                  },
                  {
                    label: 'WAVE 2',
                    enemies: [
                      {
                        name: '异化者·蝎骸',
                        hp: '14,913,226',
                        hpValue: 14913226,
                        defense: 952,
                        isBoss: true,
                      },
                    ],
                  },
                ],
              },
              {
                id: '62051041-br2',
                label: '战斗房间 2',
                waveCount: 2,
                weakness: ['物理', '电'],
                waves: [
                  {
                    label: 'WAVE 1',
                    enemies: [
                      {
                        name: '悬赏·执行者',
                        hp: '3,831,577',
                        hpValue: 3831577,
                        defense: 794,
                      },
                      {
                        name: '悬赏·威慑者',
                        hp: '2,885,082',
                        hpValue: 2885082,
                        defense: 794,
                      },
                    ],
                  },
                  {
                    label: 'WAVE 2',
                    enemies: [
                      {
                        name: '献祭·异端小丑',
                        hp: '13,657,325',
                        hpValue: 13657325,
                        defense: 952,
                        isBoss: true,
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
]

const oldDefenseSeasons: DefenseSeason[] = [
  {
    id: 'sd-old-1-4-1',
    version: '1.4',
    phase: '第 1 期',
    dateRange: '2026.1.21 - 2026.2.18',
    seasonId: '14101',
    nodeType: '稳定节点',
    rawHp: '62,500,000',
    totalHp: 62500000,
    frontiers: [
      {
        id: '1410101',
        title: '第一防线',
        level: 50,
        rooms: [
          {
            id: '14101011',
            label: '房间 1',
            level: 50,
            zoneBuffs: ['代理人生命值低于 50% 时，防御力提升 40%。'],
            roomBuff: {
              name: '坚守',
              lines: ['受到的伤害降低 20%。', '护盾效果提升 15%。'],
            },
            battleRooms: [
              {
                id: '14101011-br1',
                label: '战斗房间 1',
                waveCount: 3,
                weakness: ['火', '电'],
                waves: [
                  {
                    label: 'WAVE 1',
                    enemies: [
                      {
                        name: '装甲哈提',
                        count: 2,
                        hp: '1,200,000',
                        hpValue: 1200000,
                        defense: 520,
                      },
                    ],
                  },
                  {
                    label: 'WAVE 2',
                    enemies: [
                      {
                        name: '恶名·冥宁芙',
                        hp: '8,900,000',
                        hpValue: 8900000,
                        defense: 680,
                        isBoss: true,
                      },
                    ],
                  },
                  {
                    label: 'WAVE 3',
                    enemies: [
                      {
                        name: '猎兵',
                        count: 3,
                        hp: '980,000',
                        hpValue: 980000,
                        defense: 500,
                      },
                    ],
                  },
                ],
              },
            ],
          },
          {
            id: '14101012',
            label: '房间 2',
            level: 50,
            zoneBuffs: ['代理人受击后，下次攻击伤害提升 35%。'],
            roomBuff: {
              name: '反击',
              lines: ['反击窗口延长 1 秒。'],
            },
            battleRooms: [
              {
                id: '14101012-br1',
                label: '战斗房间 1',
                waveCount: 2,
                weakness: ['冰'],
                waves: [
                  {
                    label: 'WAVE 1',
                    enemies: [
                      {
                        name: '提丰·破坏者型',
                        hp: '6,200,000',
                        hpValue: 6200000,
                        defense: 650,
                      },
                    ],
                  },
                  {
                    label: 'WAVE 2',
                    enemies: [
                      {
                        name: '恶名·庞培',
                        hp: '12,400,000',
                        hpValue: 12400000,
                        defense: 720,
                        isBoss: true,
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        id: '1410102',
        title: '第二防线',
        level: 55,
        rooms: [
          {
            id: '14101021',
            label: '房间 1',
            level: 55,
            zoneBuffs: ['切换代理人时，新上场代理人获得护盾。'],
            roomBuff: {
              name: '协防',
              lines: ['护盾吸收量提升 25%。'],
            },
            battleRooms: [
              {
                id: '14101021-br1',
                label: '战斗房间 1',
                waveCount: 2,
                weakness: ['以太', '物理'],
                waves: [
                  {
                    label: 'WAVE 1',
                    enemies: [
                      {
                        name: '秽息妖鬼',
                        hp: '7,800,000',
                        hpValue: 7800000,
                        defense: 700,
                      },
                    ],
                  },
                  {
                    label: 'WAVE 2',
                    enemies: [
                      {
                        name: '牲鬼·布林格',
                        hp: '18,500,000',
                        hpValue: 18500000,
                        defense: 953,
                        isBoss: true,
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
]

export function getDefenseSeasons(variant: DefenseVariant): DefenseSeason[] {
  const seasons = variant === 'new' ? newDefenseSeasons : oldDefenseSeasons
  return [...seasons].sort(compareDefenseSeason)
}

function parseDefensePhase(phase: string) {
  return Number(String(phase).replace(/\D/g, '')) || 0
}

function compareDefenseSeason(a: DefenseSeason, b: DefenseSeason) {
  const versionDiff = Number(a.version) - Number(b.version)
  if (versionDiff !== 0) return versionDiff
  return parseDefensePhase(a.phase) - parseDefensePhase(b.phase)
}

export function getLatestDefenseSeasonIndex(variant: DefenseVariant) {
  const seasons = getDefenseSeasons(variant)
  return Math.max(0, seasons.length - 1)
}
