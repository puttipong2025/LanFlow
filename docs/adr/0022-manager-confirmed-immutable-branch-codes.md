# Use manager-confirmed immutable branch codes

LanFlow requires a system manager to confirm a unique 2–8 character uppercase Latin-alphanumeric branch code while adding a branch, with the UI allowed to suggest an initial value from the branch name. The code becomes immutable because offline bill identifiers embed it and may outlive the current branch name. This adds one field to branch setup but avoids collisions from deriving three characters from Thai names and prevents historical identifiers from silently changing.
