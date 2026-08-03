.actor-vault { padding: 0.75rem; }
.actor-vault__toolbar { display:flex; justify-content:space-between; gap:1rem; align-items:end; margin-bottom:0.75rem; }
.actor-vault__toolbar .hint { opacity:.75; font-size:.85em; margin-top:.25rem; }
.actor-vault__filter { display:flex; flex-direction:column; gap:.25rem; min-width:12rem; }
.actor-vault__columns { display:grid; grid-template-columns:1fr 1fr; gap:1rem; }
.actor-vault h2 { font-size:1rem; margin:.25rem 0 .5rem; border-bottom:1px solid var(--color-border-light-primary); padding-bottom:.35rem; }
.actor-vault .count { opacity:.65; font-weight:normal; }
.actor-vault__list { display:flex; flex-direction:column; gap:.4rem; }
.actor-vault__row { display:grid; grid-template-columns:42px minmax(0,1fr) auto auto; gap:.5rem; align-items:center; padding:.4rem; border:1px solid var(--color-border-light-primary); border-radius:5px; }
.actor-vault__row img { width:42px; height:42px; object-fit:cover; border:0; border-radius:4px; }
.actor-vault__identity { min-width:0; display:flex; flex-direction:column; }
.actor-vault__identity strong { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.actor-vault__identity span { opacity:.7; font-size:.8em; text-transform:capitalize; }
.actor-vault__owner { max-width:10rem; }
.actor-vault__empty { opacity:.65; font-style:italic; padding:.5rem; }
@media (max-width: 700px) {
  .actor-vault__columns { grid-template-columns:1fr; }
  .actor-vault__toolbar { align-items:stretch; flex-direction:column; }
  .actor-vault__row { grid-template-columns:38px minmax(0,1fr) auto; }
  .actor-vault__owner { grid-column:2 / 4; max-width:none; }
}
