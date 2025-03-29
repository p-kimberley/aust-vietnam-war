<?php

// =============================================================================
// FUNCTIONS.PHP
// -----------------------------------------------------------------------------
// Overwrite or add your own custom functions to X in this file.
// =============================================================================

// =============================================================================
// TABLE OF CONTENTS
// -----------------------------------------------------------------------------
//   01. Enqueue Parent Stylesheet
//   02. Additional Functions
// =============================================================================

// Enqueue Parent Stylesheet
// =============================================================================

add_filter( 'x_enqueue_parent_stylesheet', '__return_true' );

// Additional Functions
// =============================================================================

/*
 * Redirect to the user's extended profile page if the user initiated the login
 */
add_filter('rul_before_user', function($custom_redirect_to, $redirect_to, $requested_redirect_to, $user) {
    $bp_profile_link = bp_core_get_user_domain($user->ID);
    if (!$bp_profile_link)
        return $redirect_to;
    else
        return $bp_profile_link;
}, 10, 4);

/*
 * Customise the login page
 */
add_action( 'login_enqueue_scripts', function() {
    echo
    '<style type="text/css">
			body.login { background: #000; }
			#login_error { margin-top: 10px; }
			#login > p.message { margin-top: 10px; border-left-color: #dd3d36; }
			.login #login h1 a { background: url("/images/Login-Banner.png") no-repeat; width: 320px; height: 150px; margin: 0; background-size: contain; background-position: bottom; }
			#loginform { background: url("/images/Login-Form-Background.jpg"); border-radius: 5px; box-shadow: 0 1px 10px 0 rgba(255, 255, 255, 0.3); border: solid 1px #111; }
			#loginform input[type="text"], #loginform input[type="password"] { border-radius: 5px; border: solid 1px #888; border-bottom-color: #555; border-right-color: #555; }
			#loginform input[type="checkbox"] { border-radius: 2px; border: solid 1px #888; border-bottom-color: #555; border-right-color: #555; }
			#loginform label { color: #000; }
			.login form p.forgetmenot { margin-top: 6px; }
			.login form .forgetmenot label { font-size: 14px; }
			#rememberme { width: 20px; height: 20px; }
			#rememberme::before { padding-top: 1px; font-size: 25px; color: #dd3d36; }
			.login #nav > a, .login #backtoblog a { padding: 3px 10px; color: #888; font-weight: bold; transition: color .5s; }
			.login #nav > a:hover, .login #backtoblog a:hover { color: #FFF; text-decoration: underline; }
			.login #nav > a:first-of-type { background: rgba(255, 255, 255, 0.1); color: #FFF; border: solid 1px #999; border-radius: 3px; box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.2); margin-right: 10px; transition: box-shadow .5s, color .5s, background .5s; }
			.login #nav > a:first-of-type:hover { background: rgba(255, 255, 255, 0.8); color: #000; border: solid 1px #333; border-radius: 3px; box-shadow: 0 1px 5px 0 rgba(0, 0, 0, 0.5); text-decoration: none; }
			#wp-submit { background: rgba(255, 0, 0, 0.8); border: solid 1px #990000; box-shadow: 0 1px 5px 0 rgba(255, 0, 0, 0.2); transition: box-shadow .5s, background .5s; }
			#wp-submit:hover { background: rgba(255, 0, 0, 1); border: solid 1px #600000; box-shadow: 0 1px 8px 1px rgba(255, 0, 0, 0.8); }
		</style>';
});

/*
 * Replace the default link to the Wordpress homepage
 */
add_filter('login_headerurl', function() {
    return get_bloginfo('url');
});

add_filter('login_headertitle', function() {
    return get_bloginfo('name');
});

/*
 * Customise the BuddyPress activation email template
 */
add_filter( 'bp_core_signup_send_validation_email_subject', 'custom_buddypress_activation_subject', 10, 2);
function custom_buddypress_activation_subject( $subject, $user_id ) {
    return 'Vietnam War Website - Activation Required';
}

function set_bp_message_content_type() {
    return 'text/html';
}
 
add_filter( 'bp_core_signup_send_validation_email_message', 'custom_buddypress_activation_message', 10, 3 );
 

function custom_buddypress_activation_message($message, $user_id, $activate_url) {
    add_filter('wp_mail_content_type', 'set_bp_message_content_type');
	
	return "Thank you for registering for the <em>Australia's Vietnam War</em> website.<br/><br/>
		Please <a href='" . $activate_url . "'>activate your account</a> to complete signup.<br/><br/><br/>
		Sincerely,<br/><br/>
		Vietnam War Website Team";
}

/*
 * Enable TinyMCE editor for bbPress
 */
add_filter( 'bbp_after_get_the_content_parse_args', function($args = array()) {
    $args['tinymce'] = true;
    return $args;
});

/*
 * Include Fontawesome
 */
add_action('wp_head', function() {
    echo '<link rel="stylesheet" href="/src/css/vendor/fontawesome/font-awesome.min.css"/>';
});

?>