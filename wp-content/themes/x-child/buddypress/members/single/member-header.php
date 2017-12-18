<?php

/**
 * BuddyPress - Users Header
 *
 * @package BuddyPress
 * @subpackage bp-legacy
 */

?>

<?php do_action( 'bp_before_member_header' ); ?>

<div id="item-header-avatar">
	<a href="<?php bp_displayed_user_link(); ?>">

		<?php bp_displayed_user_avatar( 'type=full' ); ?>

	</a>
	<span class="activity"><?php bp_last_activity( bp_displayed_user_id() ); ?></span>
</div><!-- #item-header-avatar -->

<div id="item-header-content">

	<h1 class="x-item-header-title"><?php echo x_buddypress_get_the_title(); ?></h1>

	<?php
	//$description = get_the_author_meta('description', bp_displayed_user_id());
	$field			= array('field' => 'About me');
	$description	= bp_get_profile_field_data($field);
	if ($description)
		echo '<div class="user-description">' . $description . '</div>';
	?>

	<?php do_action( 'bp_before_member_header_meta' ); ?>
	
	<div id="item-meta">

		<?php if ( bp_is_active( 'activity' ) ) : ?>

			<div id="latest-update">
			<?php bp_activity_latest_update( bp_displayed_user_id() ); ?>
			</div>

		<?php endif; ?>

		<div id="item-buttons">

			<?php do_action( 'bp_member_header_actions' ); ?>

		</div><!-- #item-buttons -->

		<?php
		/***
		 * If you'd like to show specific profile fields here use:
		 * bp_member_profile_data( 'field=About Me' ); -- Pass the name of the field
		 */
		 do_action( 'bp_profile_header_meta' );

		 ?>

	</div><!-- #item-meta -->

</div><!-- #item-header-content -->

<?php do_action( 'bp_after_member_header' ); ?>

<?php do_action( 'template_notices' ); ?>