# Alignment

Fix the existing 2 MB Jev/Luna response guard so a configured endpoint cannot make the Host buffer an oversized body or wait for that body to finish before rejecting it. Work through the existing adapter, use synthetic localhost fixtures, and leave provider settings and the DSH Host unchanged.
