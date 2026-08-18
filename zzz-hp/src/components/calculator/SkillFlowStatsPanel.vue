<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { TeamSlot } from '@/components/calculator/DamageCalcPage.vue'
import type { AgentBuffDoc } from '@/types/calculator'
import type { SchemeSlot } from '@/types/damageCalcHistory'
import { DAMAGE_EVENT_KIND_OPTIONS } from '@/utils/damageEvent'
import type { ResolvedHit } from '@/utils/resolvedHit'
import {
  loadSkillFlowDamageRecords,
  MAX_SKILL_FLOW_DAMAGE_RECORDS,
  saveSkillFlowDamageRecords,
  type SkillFlowDamageRecord,
} from '@/utils/skillFlowDamageRecords'

const PIE_COLORS = ['#c9a55c', '#5b8def', '#e08a3c', '#4caf8a', '#9b7ed9', '#d46a6a']

const props = defineProps<{
  teamSlots: TeamSlot[]
  agents: AgentBuffDoc[]
  slots?: SchemeSlot[]
  hits?: ResolvedHit[]
  hitDamages?: Record<string, number>
  activeSlotIndex: number
  /** 当前加载的方案名；未归档为空 */
  schemeName?: string
}>()

interface PieSlice {
  name: string
  value: number
  pct: number
  color: string
}

const MAX_RECORDS = MAX_SKILL_FLOW_DAMAGE_RECORDS
const UNSAVED_SCHEME_LABEL = '未保存'

const records = ref<SkillFlowDamageRecord[]>(loadSkillFlowDamageRecords())

watch(
  records,
  (list) => {
    saveSkillFlowDamageRecords(list)
  },
  { deep: true },
)

function hitAmount(hit: ResolvedHit) {
  const value = props.hitDamages?.[hit.id]
  return Number.isFinite(value) ? Number(value) : 0
}

function formatNum(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '0'
  return Math.round(value).toLocaleString('en-US')
}

function formatPct(part: number, whole: number) {
  if (!(whole > 0) || !(part > 0)) return '0%'
  return `${((part / whole) * 100).toFixed(2)}%`
}

function agentName(agentId: string | undefined) {
  if (!agentId) return '未选'
  return props.agents.find((item) => item.id === agentId)?.name || '未知'
}

function slotTotal(index: number) {
  const slot = props.slots?.[index]
  if (!slot) return 0
  let sum = 0
  for (const entry of slot.flow) {
    const value = props.hitDamages?.[entry.id]
    if (Number.isFinite(value)) sum += Number(value)
  }
  return sum
}

const teamTotal = computed(() => {
  let sum = 0
  for (let i = 0; i < props.teamSlots.length; i += 1) sum += slotTotal(i)
  return sum
})

const currentTotal = computed(() => slotTotal(props.activeSlotIndex))

const slotRows = computed(() =>
  props.teamSlots.map((slot, index) => {
    const total = slotTotal(index)
    return {
      index,
      name: agentName(slot.agentId),
      total,
      pct: formatPct(total, teamTotal.value),
      active: index === props.activeSlotIndex,
    }
  }),
)

const currentHits = computed(() => {
  const ids = new Set((props.slots?.[props.activeSlotIndex]?.flow ?? []).map((entry) => entry.id))
  return (props.hits ?? []).filter((hit) => ids.has(hit.id))
})

function toSlices(groups: Map<string, number>): PieSlice[] {
  const total = [...groups.values()].reduce((sum, value) => sum + value, 0)
  return [...groups.entries()]
    .filter(([, value]) => value > 0)
    .map(([name, value], index) => ({
      name,
      value,
      pct: total > 0 ? (value / total) * 100 : 0,
      color: PIE_COLORS[index % PIE_COLORS.length]!,
    }))
}

const typeSlices = computed(() => {
  const groups = new Map<string, number>()
  for (const hit of currentHits.value) {
    const label =
      DAMAGE_EVENT_KIND_OPTIONS.find((item) => item.id === hit.skill.damageType)?.label ??
      hit.skill.damageType
    groups.set(label, (groups.get(label) ?? 0) + hitAmount(hit))
  }
  return toSlices(groups)
})

const staggerSlices = computed(() => {
  const groups = new Map<string, number>()
  for (const hit of currentHits.value) {
    const label = hit.staggerPhase === 'stagger' ? '失衡期' : '非失衡'
    groups.set(label, (groups.get(label) ?? 0) + hitAmount(hit))
  }
  return toSlices(groups)
})

function pieBackground(slices: PieSlice[]) {
  if (!slices.length) return '#2a3038'
  let cursor = 0
  const stops = slices.map((slice) => {
    const from = cursor
    cursor += slice.pct
    return `${slice.color} ${from}% ${cursor}%`
  })
  return `conic-gradient(${stops.join(', ')})`
}

function currentSchemeLabel() {
  const name = props.schemeName?.trim()
  return name || UNSAVED_SCHEME_LABEL
}

function formatRecordTime(savedAt: number) {
  const date = new Date(savedAt)
  if (!Number.isFinite(date.getTime())) return '—'
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function firstNameChar(name: string | undefined) {
  const trimmed = (name ?? '').trim()
  if (!trimmed || trimmed === '未选' || trimmed === '未知') return '·'
  return Array.from(trimmed)[0] ?? '·'
}

function teamInitials(rec: SkillFlowDamageRecord) {
  const names = rec.agentNames.length ? rec.agentNames : [rec.agentName]
  return names.map(firstNameChar).join('')
}

function recordTip(rec: SkillFlowDamageRecord) {
  const team = (rec.agentNames.length ? rec.agentNames : [rec.agentName]).join(' / ')
  return `${rec.schemeName}\n队伍：${team}\n当前角色：${rec.agentName}`
}

function recordNow() {
  if (records.value.length >= MAX_RECORDS) return
  const now = Date.now()
  const agentNames = props.teamSlots.map((slot) => agentName(slot.agentId))
  records.value.push({
    id: `rec-${now}-${Math.random().toString(36).slice(2, 7)}`,
    savedAt: now,
    current: currentTotal.value,
    team: teamTotal.value,
    agentName: agentName(props.teamSlots[props.activeSlotIndex]?.agentId),
    schemeName: currentSchemeLabel(),
    agentNames,
  })
}

function recordDelta(prev: number | undefined, cur: number | undefined) {
  if (!(prev != null && prev > 0)) return '—'
  const next = cur ?? 0
  const pct = ((next - prev) / prev) * 100
  const sign = pct >= 0 ? '+' : ''
  return `${sign}${pct.toFixed(2)}%`
}

function teamDelta(index: number) {
  if (index <= 0) return '—'
  return recordDelta(records.value[index - 1]?.team, records.value[index]?.team)
}

function currentDelta(index: number) {
  if (index <= 0) return '—'
  return recordDelta(records.value[index - 1]?.current, records.value[index]?.current)
}

function removeRecord(id: string) {
  records.value = records.value.filter((item) => item.id !== id)
}

function clearRecords() {
  records.value = []
}
</script>

<template>
  <section class="sf-stats" aria-label="流程伤害统计">
    <header class="sf-stats-head">
      <h3>流程伤害</h3>
      <p>按流程条目累加，口径与词条计算总伤相同。</p>
    </header>

    <div class="sf-stats-current">
      <div class="sf-stats-metric">
        <span class="sf-stats-label">全队</span>
        <strong class="sf-stats-num team">{{ formatNum(teamTotal) }}</strong>
      </div>
      <div class="sf-stats-metric">
        <span class="sf-stats-label">当前角色</span>
        <strong class="sf-stats-num current">{{ formatNum(currentTotal) }}</strong>
        <span class="sf-stats-pct">{{ formatPct(currentTotal, teamTotal) }}</span>
      </div>
    </div>

    <div class="sf-stats-team">
      <div v-for="row in slotRows" :key="row.index" class="sf-stats-agent" :class="{ active: row.active }">
        <span class="sf-stats-label">{{ row.index + 1 }} · {{ row.name }}</span>
        <strong class="sf-stats-num">{{ formatNum(row.total) }}</strong>
        <span class="sf-stats-pct">{{ row.pct }}</span>
      </div>
    </div>

    <div class="sf-stats-pies">
      <div class="sf-pie-block">
        <h4>按伤害类型</h4>
        <div class="sf-pie-row">
          <div class="sf-pie" :style="{ background: pieBackground(typeSlices) }" />
          <ul class="sf-pie-legend">
            <li v-for="slice in typeSlices" :key="slice.name">
              <i :style="{ background: slice.color }" />
              <span>{{ slice.name }}</span>
              <b>{{ formatNum(slice.value) }}</b>
              <em>{{ slice.pct.toFixed(1) }}%</em>
            </li>
            <li v-if="!typeSlices.length" class="muted">当前角色流程还没有伤害</li>
          </ul>
        </div>
      </div>
      <div class="sf-pie-block">
        <h4>按是否失衡</h4>
        <div class="sf-pie-row">
          <div class="sf-pie" :style="{ background: pieBackground(staggerSlices) }" />
          <ul class="sf-pie-legend">
            <li v-for="slice in staggerSlices" :key="slice.name">
              <i :style="{ background: slice.color }" />
              <span>{{ slice.name }}</span>
              <b>{{ formatNum(slice.value) }}</b>
              <em>{{ slice.pct.toFixed(1) }}%</em>
            </li>
            <li v-if="!staggerSlices.length" class="muted">当前角色流程还没有伤害</li>
          </ul>
        </div>
      </div>
    </div>

    <div class="sf-stats-lift">
      <div class="sf-stats-lift-head">
        <h4>伤害记录</h4>
        <div class="sf-stats-lift-actions">
          <button type="button" class="mini-btn" :disabled="records.length >= MAX_RECORDS" @click="recordNow">
            记录
          </button>
          <button type="button" class="mini-btn danger" :disabled="!records.length" @click="clearRecords">
            清空
          </button>
        </div>
      </div>
      <p class="sf-stats-hint">
        最多 {{ MAX_RECORDS }} 条，全局存在浏览器，不会被方案记录。悬停在方案列可看全称、三人与当前角色。
      </p>
      <table v-if="records.length" class="sf-rec-table">
        <thead>
          <tr>
            <th class="sf-rec-num">#</th>
            <th class="sf-rec-ctx">方案</th>
            <th class="sf-rec-time">时间</th>
            <th>全队</th>
            <th>当前角色</th>
            <th>全队较上一条</th>
            <th>当前较上一条</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(rec, index) in records" :key="rec.id">
            <td class="sf-rec-num">{{ index + 1 }}</td>
            <td class="sf-rec-ctx">
              <span class="sf-rec-clip" :title="recordTip(rec)">{{ rec.schemeName }}</span>
            </td>
            <td class="sf-rec-time">{{ formatRecordTime(rec.savedAt) }}</td>
            <td class="sf-rec-dmg">
              <span class="sf-rec-who">{{ teamInitials(rec) }}</span>
              <span>{{ formatNum(rec.team) }}</span>
            </td>
            <td class="sf-rec-dmg">
              <span class="sf-rec-who">{{ firstNameChar(rec.agentName) }}</span>
              <span>{{ formatNum(rec.current) }}</span>
            </td>
            <td>{{ teamDelta(index) }}</td>
            <td>{{ currentDelta(index) }}</td>
            <td class="sf-rec-actions">
              <button type="button" class="mini-btn danger" @click="removeRecord(rec.id)">删除</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.sf-stats {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  margin-top: 0.85rem;
  padding: 0.9rem 1rem 1.05rem;
  border-top: 1px solid #2a3038;
  background: #12161c;
}
.sf-stats-head h3,
.sf-pie-block h4,
.sf-stats-lift-head h4 {
  margin: 0;
  font-size: 0.88rem;
  color: #e8edf5;
}
.sf-stats-head p,
.sf-stats-hint {
  margin: 0.2rem 0 0;
  font-size: 0.72rem;
  color: #8b93a0;
}
.sf-stats-current {
  display: flex;
  align-items: baseline;
  gap: 1.4rem;
  flex-wrap: wrap;
}
.sf-stats-metric {
  display: flex;
  align-items: baseline;
  gap: 0.65rem;
  flex-wrap: wrap;
}
.sf-stats-label {
  font-size: 0.72rem;
  color: #9aa3b0;
}
.sf-stats-num {
  font-size: 1.15rem;
  font-weight: 700;
  color: #d7e4ff;
  font-variant-numeric: tabular-nums;
}
.sf-stats-num.team,
.sf-stats-num.current {
  font-size: 1.55rem;
}
.sf-stats-num.team {
  color: #e8edf5;
}
.sf-stats-num.current {
  color: #c4b4f0;
}
.sf-stats-pct {
  font-size: 0.85rem;
  color: #8ec8ff;
  font-variant-numeric: tabular-nums;
}
.sf-stats-team {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.55rem;
}
.sf-stats-agent {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  padding: 0.55rem 0.65rem;
  border: 1px solid #2a3038;
  border-radius: 8px;
  background: #161a20;
}
.sf-stats-agent.active {
  border-color: #c9a55c;
}
.sf-stats-pies {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 0.85rem;
}
.sf-pie-row {
  display: flex;
  align-items: center;
  gap: 0.85rem;
  margin-top: 0.45rem;
}
.sf-pie {
  flex: 0 0 5.6rem;
  width: 5.6rem;
  height: 5.6rem;
  border-radius: 50%;
  background: #2a3038;
}
.sf-pie-legend {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.28rem;
  min-width: 0;
}
.sf-pie-legend li {
  display: grid;
  grid-template-columns: 0.6rem minmax(0, 1fr) auto auto;
  gap: 0.4rem;
  align-items: center;
  font-size: 0.72rem;
  color: #c5ccd6;
}
.sf-pie-legend i {
  width: 0.55rem;
  height: 0.55rem;
  border-radius: 50%;
}
.sf-pie-legend .muted {
  display: block;
  color: #8b93a0;
}
.sf-pie-legend b,
.sf-pie-legend em {
  font-style: normal;
  font-variant-numeric: tabular-nums;
}
.sf-stats-lift-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}
.sf-stats-lift-actions {
  display: flex;
  gap: 0.35rem;
}
.mini-btn {
  border: 1px solid #3a4a31;
  border-radius: 6px;
  background: #161a20;
  color: #d8e8c8;
  padding: 0.22rem 0.55rem;
  font-size: 0.72rem;
  cursor: pointer;
}
.mini-btn:hover:not(:disabled) {
  border-color: #c9a55c;
}
.mini-btn:disabled {
  opacity: 0.45;
  cursor: default;
}
.mini-btn.danger {
  color: #e8b4b4;
  border-color: #5a3a3a;
}
.sf-rec-table {
  width: 100%;
  margin-top: 0.45rem;
  border-collapse: collapse;
  table-layout: fixed;
  font-size: 0.75rem;
  color: #d5dae4;
}
.sf-rec-table th,
.sf-rec-table td {
  padding: 0.32rem 0.4rem;
  border-bottom: 1px solid #2a3038;
  text-align: left;
  font-variant-numeric: tabular-nums;
  vertical-align: middle;
}
.sf-rec-table th {
  color: #9aa3b0;
  font-weight: 600;
}
.sf-rec-num {
  width: 2.1rem;
}
.sf-rec-time {
  width: 7.4rem;
  white-space: nowrap;
}
.sf-rec-ctx {
  width: 7.2rem;
  max-width: 7.2rem;
}
.sf-rec-clip {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: default;
}
.sf-rec-dmg {
  white-space: nowrap;
}
.sf-rec-who {
  margin-right: 0.35rem;
  color: #8b93a0;
  font-variant-numeric: normal;
  letter-spacing: 0.04em;
}
.sf-rec-actions {
  width: 3.6rem;
  text-align: right;
  white-space: nowrap;
}
@media (max-width: 800px) {
  .sf-stats-team,
  .sf-stats-pies {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
