<script lang="ts">
  import { computePosition, flip, shift, offset } from "@floating-ui/dom"

  type PlayerControlMenuProps = {
    control_name: string
    control_options: string[]
    selected_index: number
  }

  let { control_name, control_options, selected_index }: PlayerControlMenuProps = $props()
</script>

<style lang="scss">
</style>

<div class="control-button">{control_name}</div>
