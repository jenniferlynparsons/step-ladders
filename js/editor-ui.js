// Workout editor: edits an in-memory draft; nothing is stored until Save validates it.

import { h } from './dom.js';
import { validateWorkout, totalSeconds, formatTime, typeLabel, KNOWN_PHASE_TYPES, LIMITS, makeId } from './workout-model.js';

export function renderEditor({ draft, isNew, onSave, onCancel }) {
  let dirty = false;
  const root = h('div', { class: 'editor' });
  const errorBox = h('div', { class: 'flash error', role: 'alert', tabindex: '-1', hidden: true });
  const totalOut = h('output', { class: 'total' });
  const body = h('div');

  const syncTotal = () => {
    totalOut.textContent = `Total workout time: ${formatTime(totalSeconds(draft))}`;
  };

  function field(label, obj, key, { multiline = false, type = 'text', max, required = false } = {}) {
    const attrs = {
      value: multiline ? null : obj[key] ?? '',
      type: multiline ? null : type,
      maxlength: max,
      required,
      rows: multiline ? 2 : null,
      oninput: (e) => {
        obj[key] = e.target.value;
        dirty = true;
      },
    };
    const input = multiline ? h('textarea', attrs, obj[key] ?? '') : h('input', attrs);
    return h('label', { class: 'field' }, label, required && h('span', { class: 'meta' }, ' (required)'), input);
  }

  function durationField(phase) {
    return h(
      'label',
      { class: 'field narrow' },
      'Duration (seconds)',
      h('input', {
        type: 'number',
        inputmode: 'numeric',
        min: LIMITS.minSeconds,
        max: LIMITS.maxSeconds,
        step: 1,
        required: true,
        value: phase.durationSeconds,
        oninput: (e) => {
          phase.durationSeconds = e.target.value === '' ? NaN : Number(e.target.value);
          dirty = true;
          syncTotal();
        },
      }),
    );
  }

  function typeField(phase) {
    const types = KNOWN_PHASE_TYPES.includes(phase.type) ? KNOWN_PHASE_TYPES : [...KNOWN_PHASE_TYPES, phase.type];
    return h(
      'label',
      { class: 'field narrow' },
      'Type',
      h(
        'select',
        {
          onchange: (e) => {
            phase.type = e.target.value;
            dirty = true;
          },
        },
        types.map((t) => h('option', { value: t, selected: t === phase.type }, typeLabel(t))),
      ),
    );
  }

  // Reorder/duplicate/delete buttons for an item in `list`. `key` restores focus after re-render.
  function itemTools(list, i, name, keyPrefix, copy) {
    const act = (label, action, opts = {}) =>
      h(
        'button',
        {
          type: 'button',
          class: `small ${opts.className || ''}`,
          disabled: opts.disabled,
          'data-key': `${keyPrefix}-${i}-${label}`,
          'aria-label': `${label} ${name}`,
          onclick: () => {
            action();
            dirty = true;
            rerender(`${keyPrefix}-${opts.focusAfter ?? i}-${label}`);
          },
        },
        label,
      );
    return h(
      'div',
      { class: 'item-tools' },
      act('Move up', () => list.splice(i - 1, 0, ...list.splice(i, 1)), { disabled: i === 0, focusAfter: i - 1 }),
      act('Move down', () => list.splice(i + 1, 0, ...list.splice(i, 1)), { disabled: i === list.length - 1, focusAfter: i + 1 }),
      act('Duplicate', () => list.splice(i + 1, 0, copy(list[i])), { focusAfter: i + 1 }),
      act('Delete', () => list.splice(i, 1), { disabled: list.length === 1, className: 'danger', focusAfter: Math.max(0, i - 1) }),
    );
  }

  const copyPhase = (p) => ({ ...structuredClone(p), id: makeId(p.label || 'phase') });
  const copyExercise = (ex) => ({
    ...structuredClone(ex),
    id: makeId(ex.name || 'exercise'),
    phases: ex.phases.map(copyPhase),
  });

  function phaseBlock(ex, exIndex, phase, i) {
    return h(
      'fieldset',
      { class: 'phase-edit' },
      h('legend', null, `Phase ${i + 1}`),
      h(
        'div',
        { class: 'row' },
        field('Label', phase, 'label', { max: LIMITS.label, required: true }),
        typeField(phase),
        durationField(phase),
      ),
      field('Spoken instruction', phase, 'speech', { multiline: true, max: LIMITS.speech }),
      itemTools(ex.phases, i, `phase ${i + 1} of exercise ${exIndex + 1}`, `ph${exIndex}`, copyPhase),
    );
  }

  function exerciseBlock(ex, i) {
    return h(
      'fieldset',
      { class: 'exercise-edit' },
      h('legend', null, `Exercise ${i + 1}`),
      field('Name', ex, 'name', { max: LIMITS.name, required: true }),
      field('Instructions (shown on screen)', ex, 'instructions', { multiline: true, max: LIMITS.instructions }),
      ex.phases.map((p, j) => phaseBlock(ex, i, p, j)),
      h(
        'button',
        {
          type: 'button',
          'data-key': `addph-${i}`,
          onclick: () => {
            ex.phases.push({ id: makeId('phase'), type: 'work', label: '', durationSeconds: 30, speech: '' });
            dirty = true;
            rerender(`addph-${i}`);
          },
        },
        `Add phase to exercise ${i + 1}`,
      ),
      itemTools(draft.exercises, i, `exercise ${i + 1}`, 'ex', copyExercise),
    );
  }

  function rerender(focusKey) {
    body.replaceChildren(
      field('Title', draft, 'title', { max: LIMITS.title, required: true }),
      field('Description', draft, 'description', { multiline: true, max: LIMITS.description }),
      field('Source video URL', draft, 'sourceUrl', { type: 'url', max: LIMITS.url }),
      field('Notes (equipment, what is unverified, etc.)', draft, 'notes', { multiline: true, max: LIMITS.notes }),
      h('h2', null, 'Exercises'),
      ...draft.exercises.map(exerciseBlock),
      h(
        'button',
        {
          type: 'button',
          'data-key': 'addex',
          onclick: () => {
            draft.exercises.push({
              id: makeId('exercise'),
              name: '',
              instructions: '',
              phases: [{ id: makeId('phase'), type: 'work', label: '', durationSeconds: 30, speech: '' }],
            });
            dirty = true;
            rerender('addex');
          },
        },
        'Add exercise',
      ),
    );
    syncTotal();
    if (focusKey) {
      const el = body.querySelector(`[data-key="${focusKey}"]`);
      if (el && !el.disabled) el.focus();
      else (el?.parentElement.querySelector('button:not(:disabled)') || body.querySelector('input'))?.focus();
    }
  }

  function save(e) {
    e.preventDefault();
    const result = validateWorkout(draft);
    let errors = result.errors;
    if (result.ok) {
      try {
        onSave(result.workout);
        return;
      } catch (err) {
        errors = err.message.split('\n');
      }
    }
    errorBox.replaceChildren(
      h('p', null, h('strong', null, 'Please fix the following before saving:')),
      h('ul', null, errors.map((msg) => h('li', null, msg))),
    );
    errorBox.hidden = false;
    errorBox.focus();
  }

  rerender();
  root.append(
    h('h1', null, isNew ? 'New workout' : 'Edit workout'),
    errorBox,
    h(
      'form',
      { novalidate: true, onsubmit: save },
      body,
      h(
        'div',
        { class: 'sticky-actions' },
        totalOut,
        h('button', { type: 'submit', class: 'primary' }, 'Save'),
        h(
          'button',
          {
            type: 'button',
            onclick: () => {
              if (!dirty || confirm('Discard unsaved changes?')) onCancel();
            },
          },
          'Cancel',
        ),
      ),
    ),
  );
  return root;
}
