# Sketch-recognition fixtures

`tere.png` is the Lewis-structure regression image supplied for the
lone-pair-recognition fix. Its expected molecular result is terephthalic acid,
equivalent to:

```text
O=C(O)c1ccc(C(=O)O)cc1
```

Acceptance checks:

- the four pairs of black electron dots around the two carbonyl oxygens do not
  become atoms, bonds, charges, or disconnected fragments;
- the two explicitly drawn O-H hydrogens preserve the two carboxylic-acid
  groups;
- the two carboxylic-acid substituents remain para on the benzene ring.
