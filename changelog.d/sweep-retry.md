A project folder sweep that fails is tried again at a later tick (10 minutes, 20, 40, then every hour) and each failure is logged with its error; before, the failure was forgotten.
