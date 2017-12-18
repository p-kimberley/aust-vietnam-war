<div id="buddypress">

	<?php do_action( 'bp_before_activation_page' ); ?>

	<div class="page" id="activate-page">

		<?php do_action( 'template_notices' ); ?>

		<?php do_action( 'bp_before_activate_content' ); ?>

		<?php if ( bp_account_was_activated() ) : ?>

			<?php if ( isset( $_GET['e'] ) ) : ?>
				<p><?php _e( 'Your account has been successfully activated. Your account details have been sent to you in a separate email.', 'buddypress' ); ?></p>
			<?php else : ?>
				<?php printf( __('
				<p>Thank you for registering as a member of the <em>Australia`s Vietnam War</em> website.</p>
				<p>To get started, we recommend reading the <em>Getting Started</em> topics on the home page. 
				As a member, you can now comment on articles, post to the discussion forum and contribute content in the Battle Map.</p>
				<h4>Next Steps</h4>
				<p>You can now <a href="%s" style="text-decoration: underline; color: #FF0000">log in</a> 
				with the username and password you provided when you signed up. 
				After logging in, you will be taken to your profile page. Please take the time to edit it, including your service history (if applicable) 
				so other people can understand your background when reading your contributions.</p>
				', 'buddypress' ), wp_login_url( bp_get_root_domain() ) ); ?>
			<?php endif; ?>

		<?php else : ?>

			<form action="" method="get" class="standard-form cf man" id="activation-form">

				<label for="key"><?php _e( 'Please provide a valid activation key.', 'buddypress' ); ?></label>
				<input type="text" name="key" id="key" value="" />

				<p class="submit">
					<input type="submit" name="submit" value="<?php esc_attr_e( 'Activate', 'buddypress' ); ?>" />
				</p>

			</form>

		<?php endif; ?>

		<?php do_action( 'bp_after_activate_content' ); ?>

	</div><!-- .page -->

	<?php do_action( 'bp_after_activation_page' ); ?>

</div><!-- #buddypress -->